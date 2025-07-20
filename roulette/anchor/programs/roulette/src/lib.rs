use anchor_lang::{
    prelude::*,
    solana_program::{clock, hash::hash},
};
use anchor_spl::{
    token::Token,
    token_interface,
    token_interface::{TokenAccount, Mint, TransferChecked},
};
use bytemuck;

// Replace with actual program ID from `anchor keys list`
declare_id!("4Nd1mYwqR5o6jQe9sQn8Qk1Qk1Qk1Qk1Qk1Qk1Qk1Qk1");

// Constants
const GAME_SEED: &[u8] = b"GAME";
const VAULT_SEED: &[u8] = b"VAULT";
const MIN_BET: u64 = 1_000_000_000_000_000_000; // 1 token (18 decimals, like APTC)
const MAX_BET: u64 = 18_446_744_073_709_551_615; // max u64 value
const MAX_RESULT: u64 = 37; // 0-36 for roulette
const PAYOUTS: [u64; 10] = [36, 2, 2, 2, 3, 3, 18, 12, 9, 6]; // Payout multipliers
const TREASURY_FEE_BPS: u64 = 5; // 0.5% fee
const BPS_DENOMINATOR: u64 = 1000;
const COOLDOWN_SECONDS: i64 = 3; // 3-second cooldown
const MIN_WAIT_SLOTS: u64 = 1; // Solana equivalent of MIN_WAIT_BLOCK

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum BetType {
    Number = 0,
    Color = 1,
    OddEven = 2,
    HighLow = 3,
    Dozen = 4,
    Column = 5,
    Split = 6,
    Street = 7,
    Corner = 8,
    Line = 9,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Bet {
    pub player: Pubkey,
    pub amount: u64,
    pub bet_type: u8,
    pub bet_value: u8,
    pub numbers: Vec<u8>,
    pub round: u64,
}

#[account]
pub struct GameState {
    pub bets: Vec<Bet>,
    pub round: u64,
    pub min_bet: u64,
    pub treasury: Pubkey,
    pub token_mint: Pubkey,
    pub bump: u8,
    pub nonce: u64,
    pub last_slot: u64,
    pub random_result: u64,
    pub timestamp: i64,
}

#[account]
pub struct PlayerBetTime {
    pub last_bet_time: i64,
}

#[event]
pub struct BetPlaced {
    pub player: Pubkey,
    pub amount: u64,
    pub bet_type: u8,
    pub bet_value: u8,
    pub numbers: Vec<u8>,
    pub round: u64,
}

#[event]
pub struct BetResult {
    pub player: Pubkey,
    pub amount: u64,
    pub won: bool,
    pub winnings: u64,
    pub round: u64,
}

#[event]
pub struct RandomGenerated {
    pub random_number: u64,
    pub round: u64,
}

#[event]
pub struct RequestAllowanceEvent {
    pub player: Pubkey,
    pub amount: u64,
}

fn validate_bet(bet_type: u8, bet_value: u8, numbers: &Vec<u8>) -> Result<()> {
    match bet_type {
        0 => require!(bet_value <= 36 && numbers.is_empty(), ErrorCode::InvalidBet),
        1 | 2 | 3 => require!(bet_value <= 1 && numbers.is_empty(), ErrorCode::InvalidBet),
        4 | 5 => require!(bet_value <= 2 && numbers.is_empty(), ErrorCode::InvalidBet),
        6 => {
            require!(numbers.len() == 2, ErrorCode::InvalidBet);
            for &n in numbers {
                require!(n <= 36, ErrorCode::InvalidBet);
            }
            require!(is_adjacent_split(numbers[0], numbers[1]), ErrorCode::InvalidBet);
        }
        7 => {
            require!(numbers.len() == 3, ErrorCode::InvalidBet);
            for &n in numbers {
                require!(n <= 36, ErrorCode::InvalidBet);
            }
        }
        8 => {
            require!(numbers.len() == 4, ErrorCode::InvalidBet);
            for &n in numbers {
                require!(n <= 36, ErrorCode::InvalidBet);
            }
        }
        9 => {
            require!(numbers.len() == 6, ErrorCode::InvalidBet);
            for &n in numbers {
                require!(n <= 36, ErrorCode::InvalidBet);
            }
        }
        _ => return err!(ErrorCode::InvalidBet),
    }
    Ok(())
}

fn is_adjacent_split(num1: u8, num2: u8) -> bool {
    let diff = if num1 > num2 { num1 - num2 } else { num2 - num1 };
    diff == 1 || diff == 3 // Simplified adjacency check
}

fn is_red_number(number: u8) -> bool {
    let red_numbers = [
        1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
    ];
    red_numbers.contains(&number)
}

fn calculate_winnings(bet: &Bet, random_result: u8) -> Result<(bool, u64)> {
    match bet.bet_type {
        0 => {
            if bet.bet_value == random_result {
                return Ok((true, bet.amount.checked_mul(PAYOUTS[0]).ok_or(ErrorCode::ArithmeticOverflow)?));
            }
        }
        1 => {
            let is_red = is_red_number(random_result);
            if (bet.bet_value == 0 && is_red) || (bet.bet_value == 1 && !is_red) {
                return Ok((true, bet.amount.checked_mul(PAYOUTS[1]).ok_or(ErrorCode::ArithmeticOverflow)?));
            }
        }
        2 => {
            if random_result != 0 {
                let is_even = random_result % 2 == 0;
                if (bet.bet_value == 0 && !is_even) || (bet.bet_value == 1 && is_even) {
                    return Ok((true, bet.amount.checked_mul(PAYOUTS[2]).ok_or(ErrorCode::ArithmeticOverflow)?));
                }
            }
        }
        3 => {
            if random_result != 0 {
                let is_high = random_result >= 19;
                if (bet.bet_value == 0 && !is_high) || (bet.bet_value == 1 && is_high) {
                    return Ok((true, bet.amount.checked_mul(PAYOUTS[3]).ok_or(ErrorCode::ArithmeticOverflow)?));
                }
            }
        }
        4 => {
            if random_result != 0 {
                let dozen = (random_result - 1) / 12;
                if bet.bet_value == dozen as u8 {
                    return Ok((true, bet.amount.checked_mul(PAYOUTS[4]).ok_or(ErrorCode::ArithmeticOverflow)?));
                }
            }
        }
        5 => {
            if random_result != 0 {
                let column = (random_result - 1) % 3;
                if bet.bet_value == column as u8 {
                    return Ok((true, bet.amount.checked_mul(PAYOUTS[5]).ok_or(ErrorCode::ArithmeticOverflow)?));
                }
            }
        }
        6 | 7 | 8 | 9 => {
            if contains_number(&bet.numbers, random_result) {
                let multiplier = PAYOUTS[bet.bet_type as usize];
                return Ok((true, bet.amount.checked_mul(multiplier).ok_or(ErrorCode::ArithmeticOverflow)?));
            }
        }
        _ => {}
    }
    Ok((false, 0))
}

fn contains_number(numbers: &Vec<u8>, target: u8) -> bool {
    numbers.contains(&target)
}

fn generate_random_number(
    recent_blockhashes: &UncheckedAccount,
    clock: &clock::Clock,
    player: &Pubkey,
    nonce: u64,
) -> u64 {
    let blockhash = recent_blockhashes.data.borrow();
    let hash_input = [
        &blockhash[0..32], // Recent blockhash
        &clock.unix_timestamp.to_le_bytes(),
        player.as_ref(),
        &nonce.to_le_bytes(),
    ]
    .concat();
    let hash = hash(&hash_input);
    let hash_bytes_arr = hash.to_bytes();
    let hash_bytes: &[u64] = bytemuck::cast_slice(&hash_bytes_arr);
    hash_bytes[0] % MAX_RESULT
}

#[program]
pub mod roulette {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, min_bet: u64, treasury: Pubkey, token_mint: Pubkey) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        require!(min_bet >= MIN_BET, ErrorCode::BelowMinBet);
        require!(token_mint != Pubkey::default(), ErrorCode::InvalidTokenMint);
        game_state.bump = ctx.bumps.game_state;
        game_state.min_bet = min_bet;
        game_state.treasury = treasury;
        game_state.token_mint = token_mint;
        game_state.bets = Vec::new();
        game_state.round = 1;
        game_state.nonce = 0;
        game_state.last_slot = 0;
        game_state.random_result = 0;
        game_state.timestamp = 0;
        Ok(())
    }

    pub fn place_bet(
        ctx: Context<PlaceBet>,
        bet_type: u8,
        bet_value: u8,
        numbers: Vec<u8>,
        amount: u64,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        let clock = clock::Clock::get()?;

        // Cooldown check
        let last_bet_time = ctx.accounts.player_bet_time.last_bet_time;
        require!(clock.unix_timestamp - last_bet_time >= COOLDOWN_SECONDS, ErrorCode::CooldownNotMet);

        // Slot wait check
        require!(clock.slot > game_state.last_slot + MIN_WAIT_SLOTS, ErrorCode::SlotWaitNotMet);

        // Validate bet
        require!(amount >= game_state.min_bet && amount <= MAX_BET, ErrorCode::InvalidBetAmount);
        validate_bet(bet_type, bet_value, &numbers)?;

        // Check token balance
        let player_balance = ctx.accounts.player_token.amount;
        require!(player_balance >= amount, ErrorCode::InsufficientBalance);

        // Transfer tokens to vault
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.player_token.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
            to: ctx.accounts.vault_token.to_account_info(),
            authority: ctx.accounts.player.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token_interface::transfer_checked(CpiContext::new(cpi_program, cpi_accounts), amount, ctx.accounts.token_mint.decimals)?;

        // Store bet
        let bet = Bet {
            player: ctx.accounts.player.key(),
            amount,
            bet_type,
            bet_value,
            numbers: numbers.clone(),
            round: game_state.round,
        };
        game_state.bets.push(bet);

        // Generate random number
        let random_result = generate_random_number(
            &ctx.accounts.recent_blockhashes,
            &clock,
            &ctx.accounts.player.key(),
            game_state.nonce,
        );
        game_state.random_result = random_result;
        game_state.nonce += 1;
        game_state.last_slot = clock.slot;
        game_state.timestamp = clock.unix_timestamp;

        emit!(RandomGenerated {
            random_number: random_result,
            round: game_state.round,
        });

        // Process bets
        let bump = ctx.bumps.vault_token;
        let signer: &[&[&[u8]]] = &[&[VAULT_SEED, &[bump]]];

        for bet in game_state.bets.iter() {
            let player_token = if bet.player == ctx.accounts.player_token.owner {
                ctx.accounts.player_token.to_account_info()
            } else {
                // For other players' bets, skip payout (client must call place_bet to claim)
                continue;
            };

            let (won, winnings) = calculate_winnings(bet, random_result as u8)?;
            if won {
                let fee = winnings.checked_mul(TREASURY_FEE_BPS).ok_or(ErrorCode::ArithmeticOverflow)? / BPS_DENOMINATOR;
                let payout = winnings.checked_sub(fee).ok_or(ErrorCode::ArithmeticOverflow)?;

                // Pay player
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.vault_token.to_account_info(),
                            mint: ctx.accounts.token_mint.to_account_info(),
                            to: player_token,
                            authority: ctx.accounts.vault_token.to_account_info(),
                        },
                        signer,
                    ),
                    payout,
                    ctx.accounts.token_mint.decimals,
                )?;

                // Pay treasury
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.vault_token.to_account_info(),
                            mint: ctx.accounts.token_mint.to_account_info(),
                            to: ctx.accounts.treasury_token.to_account_info(),
                            authority: ctx.accounts.vault_token.to_account_info(),
                        },
                        signer,
                    ),
                    fee,
                    ctx.accounts.token_mint.decimals,
                )?;

                emit!(BetResult {
                    player: bet.player,
                    amount: bet.amount,
                    won: true,
                    winnings: payout,
                    round: bet.round,
                });
            } else {
                // Pay treasury
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.vault_token.to_account_info(),
                            mint: ctx.accounts.token_mint.to_account_info(),
                            to: ctx.accounts.treasury_token.to_account_info(),
                            authority: ctx.accounts.vault_token.to_account_info(),
                        },
                        signer,
                    ),
                    bet.amount,
                    ctx.accounts.token_mint.decimals,
                )?;

                emit!(BetResult {
                    player: bet.player,
                    amount: bet.amount,
                    won: false,
                    winnings: 0,
                    round: bet.round,
                });
            }
        }

        // Clear bets and advance round
        game_state.bets.clear();
        game_state.round += 1;

        emit!(BetPlaced {
            player: ctx.accounts.player.key(),
            amount,
            bet_type,
            bet_value,
            numbers: numbers.clone(),
            round: game_state.round - 1,
        });

        Ok(())
    }

    pub fn set_min_bet(ctx: Context<SetMinBet>, min_bet: u64) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        require_keys_eq!(ctx.accounts.admin.key(), game_state.treasury, ErrorCode::Unauthorized);
        require!(min_bet >= MIN_BET, ErrorCode::BelowMinBet);
        game_state.min_bet = min_bet;
        Ok(())
    }

    pub fn withdraw_tokens(ctx: Context<WithdrawTokens>, amount: u64) -> Result<()> {
        let game_state = &ctx.accounts.game_state;
        require_keys_eq!(ctx.accounts.admin.key(), game_state.treasury, ErrorCode::Unauthorized);
        let bump = ctx.bumps.vault_token;
        let signer: &[&[&[u8]]] = &[&[VAULT_SEED, &[bump]]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_token.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.treasury_token.to_account_info(),
                    authority: ctx.accounts.vault_token.to_account_info(),
                },
                signer,
            ),
            amount,
            ctx.accounts.token_mint.decimals,
        )?;

        Ok(())
    }

    pub fn request_allowance(ctx: Context<RequestAllowance>, amount: u64) -> Result<()> {
        emit!(RequestAllowanceEvent {
            player: ctx.accounts.player.key(),
            amount,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        init,
        seeds = [GAME_SEED],
        payer = player,
        space = 8 + 32 + 8 + 8 + 32 + 32 + 1 + 8 + 8 + 8 + 100 * (32 + 8 + 1 + 1 + 32 + 8), // Space for 100 bets
        bump,
    )]
    pub game_state: Account<'info, GameState>,
    #[account(mut)]
    pub vault_token: InterfaceAccount<'info, TokenAccount>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [GAME_SEED],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = player_token.mint == game_state.token_mint)]
    pub player_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = treasury_token.mint == game_state.token_mint)]
    pub treasury_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + 8,
        seeds = [b"LAST_BET", player.key().as_ref()],
        bump
    )]
    pub player_bet_time: Account<'info, PlayerBetTime>,
    /// CHECK: This is a sysvar account for recent blockhashes, safe because it's a well-known sysvar
    pub recent_blockhashes: UncheckedAccount<'info>,
    #[account(constraint = token_mint.key() == game_state.token_mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetMinBet<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub game_state: Account<'info, GameState>,
}

#[derive(Accounts)]
pub struct WithdrawTokens<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub game_state: Account<'info, GameState>,
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = treasury_token.mint == game_state.token_mint)]
    pub treasury_token: InterfaceAccount<'info, TokenAccount>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RequestAllowance<'info> {
    pub player: Signer<'info>,
    #[account(seeds = [GAME_SEED], bump)]
    pub game_state: Account<'info, GameState>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Bet amount must be at least the minimum bet")]
    BelowMinBet,
    #[msg("Invalid bet type or value")]
    InvalidBet,
    #[msg("Insufficient token balance")]
    InsufficientBalance,
    #[msg("Must wait 3 seconds between bets")]
    CooldownNotMet,
    #[msg("Must wait at least 1 slot between randomness requests")]
    SlotWaitNotMet,
    #[msg("Unauthorized: only treasury can perform this action")]
    Unauthorized,
    #[msg("Invalid token mint")]
    InvalidTokenMint,
    #[msg("Invalid bet amount")]
    InvalidBetAmount,
    #[msg("Arithmetic overflow in winnings calculation")]
    ArithmeticOverflow,
}