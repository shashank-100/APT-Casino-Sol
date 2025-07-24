use anchor_lang::prelude::*;

declare_id!("HEze64wGfroApJ15PMLJjWYbNWo9zB4cz9oTvJt2F4aj");

// Constants for the game
const MAX_BOARD_SIZE: usize = 25;
const MAX_MINES: usize = 24;

#[program]
pub mod mines {
    use super::*;

    pub fn start_game(
        ctx: Context<StartGame>,
        bet_amount: u64,
        num_mines: u8,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;

        // Use MAX_MINES constant here
        require!(
            num_mines > 0 && (num_mines as usize) <= MAX_MINES && (num_mines as usize) < MAX_BOARD_SIZE,
            CustomError::InvalidNumMines
        );

        game.player = ctx.accounts.player.key();
        game.bet_amount = bet_amount;
        game.num_mines = num_mines;
        game.revealed_tiles = [false; MAX_BOARD_SIZE];
        game.is_active = true;

        // Pseudo-random mine placement using block timestamp
        let clock = Clock::get()?;
        let seed = clock.unix_timestamp as u64;
        let mut mine_positions = [false; MAX_BOARD_SIZE];
        let mut placed = 0;
        let mut i = 0;

        while placed < num_mines {
            let pos = ((seed + i) % MAX_BOARD_SIZE as u64) as usize;
            if !mine_positions[pos] {
                mine_positions[pos] = true;
                placed += 1;
            }
            i += 1;
        }

        game.mine_positions = mine_positions;
        Ok(())
    }

    pub fn reveal_tile(ctx: Context<RevealTile>, tile_index: u8) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.is_active, CustomError::GameNotActive);
        require!((tile_index as usize) < MAX_BOARD_SIZE, CustomError::InvalidTileIndex);
        require!(!game.revealed_tiles[tile_index as usize], CustomError::TileAlreadyRevealed);

        game.revealed_tiles[tile_index as usize] = true;

        if game.mine_positions[tile_index as usize] {
            game.is_active = false; // Game over
        }

        Ok(())
    }

    pub fn cash_out(ctx: Context<CashOut>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.is_active, CustomError::GameNotActive);
        game.is_active = false;

        // TODO: Handle fund transfer logic here

        Ok(())
    }
}

#[derive(Accounts)]
pub struct StartGame<'info> {
    #[account(init, payer = player, space = 8 + MinesGame::LEN)]
    pub game: Account<'info, MinesGame>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealTile<'info> {
    #[account(mut, has_one = player)]
    pub game: Account<'info, MinesGame>,
    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct CashOut<'info> {
    #[account(mut, has_one = player)]
    pub game: Account<'info, MinesGame>,
    pub player: Signer<'info>,
}

#[account]
pub struct MinesGame {
    pub player: Pubkey,
    pub bet_amount: u64,
    pub num_mines: u8,
    pub mine_positions: [bool; MAX_BOARD_SIZE],
    pub revealed_tiles: [bool; MAX_BOARD_SIZE],
    pub is_active: bool,
}

impl MinesGame {
    // 32 (Pubkey) + 8 (u64) + 1 (u8) + 25 + 25 (bool arrays) + 1 (bool)
    pub const LEN: usize = 32 + 8 + 1 + 25 + 25 + 1;
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
}
