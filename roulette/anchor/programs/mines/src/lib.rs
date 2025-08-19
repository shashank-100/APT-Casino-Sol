use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv; // for simple commit-reveal hash
use anchor_lang::system_program; // for system_program::transfer

declare_id!("HEze64wGfroApJ15PMLJjWYbNWo9zB4cz9oTvJt2F4aj");

// Constants
const MAX_BOARD_SIZE: usize = 25;
const MAX_MINES: usize = 24;
const MERKLE_DEPTH: usize = 5; // ceil(log2(25)) = 5
const DEFAULT_EXPIRY_SECS: i64 = 600; // 10 minutes timeout

// Game state
const STATE_COMMITTED: u8 = 0; // Using Merkle root; no global reveal step required
const STATE_FINISHED: u8 = 2;

#[program]
pub mod mines {
    use super::*;

    /// Start a new game:
    /// - initializes `game` account (owned by program)
    /// - initializes `vault` PDA (owned by program) (holds lamports)
    /// - stores the commit hash (commitment) instead of on-chain mine positions
    pub fn start_game(
        ctx: Context<StartGame>,
        bet_amount: u64,
        num_mines: u8,
        commitment: [u8; 32], // Merkle root of leaves (one per tile)
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;

        // basic validations
        require!(bet_amount > 0, CustomError::InvalidBetAmount);
        require!(
            num_mines > 0 && (num_mines as usize) <= MAX_MINES && (num_mines as usize) < MAX_BOARD_SIZE,
            CustomError::InvalidNumMines
        );

        // fill game state
        game.player = ctx.accounts.player.key();
        game.house = ctx.accounts.house.key();
        game.bet_amount = bet_amount;
        game.num_mines = num_mines;
        game.revealed_tiles = [false; MAX_BOARD_SIZE];
        game.mine_positions = [false; MAX_BOARD_SIZE]; // unused with Merkle per-tile proofs; kept for compatibility
        game.is_active = true;
        game.lost = false;
        game.revealed_count = 0;
        game.commitment = commitment;
        game.state = STATE_COMMITTED;
        let now = Clock::get()?.unix_timestamp;
        game.started_at = now;
        game.expiry_ts = now.saturating_add(DEFAULT_EXPIRY_SECS);

        // set vault bump in its data
        let vault_bump = ctx.bumps.vault;
        ctx.accounts.vault.bump = vault_bump;

        // Transfer bet lamports from player into vault PDA
        // player must be mutable (payer). Vault already created by Anchor `init`.
        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts),
            bet_amount,
        )?;

        Ok(())
    }

    /// Deprecated: global reveal is removed in favor of per-tile Merkle proofs.
    /// Retained to avoid IDL drift for older clients; now always errors.
    pub fn set_mine_positions(_ctx: Context<SetMinePositions>, _nonce: [u8; 32], _bytes: [u8; MAX_BOARD_SIZE]) -> Result<()> {
        err!(CustomError::DeprecatedInstruction)
    }

    /// Player reveals a tile by providing a Merkle proof for that tile.
    /// Leaf hash = hash("leaf" || tile_index || is_mine || leaf_nonce)
    /// `proof` is fixed-depth MERKLE_DEPTH; `path_bits` indicates left/right at each depth (LSB = level 0).
    pub fn reveal_tile(
        ctx: Context<RevealTile>,
        tile_index: u8,
        is_mine: u8, // 0 or 1
        leaf_nonce: [u8; 32],
        proof: [[u8; 32]; MERKLE_DEPTH],
        path_bits: u32,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.is_active, CustomError::GameNotActive);
        require!(game.state == STATE_COMMITTED, CustomError::GameNotRevealed);
        require!((tile_index as usize) < MAX_BOARD_SIZE, CustomError::InvalidTileIndex);
        require!(!game.revealed_tiles[tile_index as usize], CustomError::TileAlreadyRevealed);

        // Verify Merkle proof against committed root
        let leaf = compute_leaf_hash(tile_index, is_mine, &leaf_nonce);
        let root = compute_merkle_root(leaf, &proof, path_bits);
        require!(root == game.commitment, CustomError::InvalidCommitment);

        game.revealed_tiles[tile_index as usize] = true;
        game.revealed_count = game.revealed_count.saturating_add(1);

        if is_mine != 0 {
            // player hit a mine => game lost
            game.is_active = false;
            game.lost = true;
            game.state = STATE_FINISHED;
        }

        Ok(())
    }

    /// Player cashes out (only allowed when game is active and not lost).
    /// This will close both the vault PDA and the game account and send all vault lamports to player.
    pub fn cash_out(ctx: Context<CashOut>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.is_active, CustomError::GameNotActive);
        require!(!game.lost, CustomError::PlayerLost);
        require!(game.revealed_count > 0, CustomError::NothingToCashOut);

        game.is_active = false;
        game.state = STATE_FINISHED;

        // Anchor will automatically close `vault` to `player` (per close attribute),
        // and close `game` to `player`.
        Ok(())
    }

    /// House collects funds when player lost (sweeps the vault).
    /// `house` must be the same public key saved at start_game and must sign to collect.
    pub fn collect_house(ctx: Context<CollectHouse>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.lost, CustomError::GameNotLost);

        // Anchor will close `vault` and `game` to `house` (close = house), returning lamports to house.
        Ok(())
    }

    /// If the house never provides proofs and the game stalls past expiry, the player can abort and refund.
    pub fn abort_refund(ctx: Context<AbortRefund>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.is_active, CustomError::GameNotActive);
        require!(!game.lost, CustomError::PlayerLost);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= game.expiry_ts, CustomError::NotExpired);

        game.is_active = false;
        game.state = STATE_FINISHED;
        Ok(())
    }
}

/*** Accounts & structs ***/

#[derive(Accounts)]
pub struct StartGame<'info> {
    #[account(init, payer = player, space = 8 + MinesGame::LEN)]
    pub game: Account<'info, MinesGame>,

    // Vault PDA to store lamports; small account that stores the bump.
    #[account(
        init,
        payer = player,
        seeds = [b"vault", game.key().as_ref()],
        bump,
        space = 8 + Vault::LEN
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub player: Signer<'info>,

    /// CHECK: house is just a public key / recipient (not owned by program here)
    pub house: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetMinePositions<'info> {
    #[account(mut, has_one = house)]
    pub game: Account<'info, MinesGame>,

    /// House must sign to reveal positions (must match game.house).
    pub house: Signer<'info>,
}

#[derive(Accounts)]
pub struct RevealTile<'info> {
    #[account(mut, has_one = player)]
    pub game: Account<'info, MinesGame>,

    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct CashOut<'info> {
    // Close the game acct to player when successful cash_out.
    #[account(mut, has_one = player, close = player)]
    pub game: Account<'info, MinesGame>,

    // Close the vault PDA and send lamports to player (close = player).
    #[account(mut, seeds = [b"vault", game.key().as_ref()], bump, close = player)]
    pub vault: Account<'info, Vault>,

    /// Player must be writable because lamports will arrive here and account will be recipient of closes.
    #[account(mut)]
    pub player: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CollectHouse<'info> {
    // Close the game acct to house
    #[account(mut, has_one = house, close = house)]
    pub game: Account<'info, MinesGame>,

    // Close the vault PDA and send lamports to house
    #[account(mut, seeds = [b"vault", game.key().as_ref()], bump, close = house)]
    pub vault: Account<'info, Vault>,

    /// House must sign to collect lost funds
    #[account(mut)]
    pub house: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AbortRefund<'info> {
    // Close the game acct to player
    #[account(mut, has_one = player, close = player)]
    pub game: Account<'info, MinesGame>,

    // Close the vault PDA and send lamports to player (close = player)
    #[account(mut, seeds = [b"vault", game.key().as_ref()], bump, close = player)]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub player: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Vault {
    pub bump: u8,
}
impl Vault {
    pub const LEN: usize = 1;
}

#[account]
pub struct MinesGame {
    pub player: Pubkey,                       // 32
    pub house: Pubkey,                        // 32 (who collects on loss)
    pub bet_amount: u64,                      // 8
    pub num_mines: u8,                        // 1
    pub mine_positions: [bool; MAX_BOARD_SIZE], // 25 (set only after reveal)
    pub revealed_tiles: [bool; MAX_BOARD_SIZE], // 25
    pub is_active: bool,                      // 1
    pub lost: bool,                           // 1
    pub revealed_count: u8,                   // 1
    pub commitment: [u8; 32],                 // 32 (commitment hash)
    pub state: u8,                            // 1 (STATE_COMMITTED/STATE_FINISHED)
    pub started_at: i64,                      // 8
    pub expiry_ts: i64,                       // 8
}

impl MinesGame {
    // Total fields size (without discriminator): 175 bytes given MAX_BOARD_SIZE=25
    pub const LEN: usize = 32 + 32 + 8 + 1 + MAX_BOARD_SIZE + MAX_BOARD_SIZE + 1 + 1 + 1 + 32 + 1 + 8 + 8;
}

#[error_code]
pub enum CustomError {
    #[msg("Invalid number of mines")]
    InvalidNumMines,
    #[msg("Game is not active")]
    GameNotActive,
    #[msg("Invalid tile index")]
    InvalidTileIndex,
    #[msg("Tile already revealed")]
    TileAlreadyRevealed,
    #[msg("Invalid bet amount")]
    InvalidBetAmount,
    #[msg("Insufficient funds in vault")]
    InsufficientVaultFunds,
    #[msg("Deprecated instruction")]
    DeprecatedInstruction,
    #[msg("Commitment mismatch")]
    InvalidCommitment,
    #[msg("Game not revealed yet")]
    GameNotRevealed,
    #[msg("Player already lost")]
    PlayerLost,
    #[msg("Game not lost")]
    GameNotLost,
    #[msg("Nothing to cash out yet")]
    NothingToCashOut,
    #[msg("Game not expired yet")]
    NotExpired,
}

// Helpers
fn compute_leaf_hash(tile_index: u8, is_mine: u8, leaf_nonce: &[u8; 32]) -> [u8; 32] {
    let ti = (tile_index as u32).to_le_bytes();
    let im = [is_mine];
    hashv(&[b"leaf", &ti[..], &im[..], &leaf_nonce[..]]).to_bytes()
}

fn compute_merkle_root(current: [u8; 32], proof: &[[u8; 32]; MERKLE_DEPTH], path_bits: u32) -> [u8; 32] {
    let mut hash = current;
    for level in 0..MERKLE_DEPTH {
        let sibling = proof[level];
        let is_right = ((path_bits >> level) & 1) == 1;
        hash = if is_right {
            // current is right child
            hashv(&[&sibling[..], &hash[..]]).to_bytes()
        } else {
            // current is left child
            hashv(&[&hash[..], &sibling[..]]).to_bytes()
        };
    }
    hash
}
