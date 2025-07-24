use anchor_lang::prelude::*;

declare_id!("JAVuBXeBZqXNtS73azhBDAoYaaAFfo4gWXoZe2e7Jf8H");

#[program]
pub mod roulette {
    use super::*;

    pub fn play_roulette(
        ctx: Context<PlayRoulette>,
        bet_amount: u64,
        bet_type: BetType,
        bet_value: u8, // Depends on bet_type
    ) -> Result<()> {
        require!(bet_amount > 0, CustomError::InvalidBetAmount);
        // Only check bet_value for Number bets
        if let BetType::Number = bet_type {
            require!(bet_value <= 36, CustomError::InvalidBetValue);
        }

        // Save keys and account infos before mutable borrow
        let game_key = ctx.accounts.game.key();
        let game_account_info = ctx.accounts.game.to_account_info();
        let player_key = ctx.accounts.player.key();
        let player_account_info = ctx.accounts.player.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();

        let clock = Clock::get()?;
        // WARNING: This is NOT secure randomness. For production, use a VRF oracle (e.g., Switchboard, Chainlink VRF).
        let spin_result = (clock.unix_timestamp % 37) as u8; // 0 to 36

        // Transfer SOL from player to contract using system program CPI
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &player_key,
            &game_key,
            bet_amount,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                player_account_info.clone(),
                game_account_info.clone(),
                system_program_info.clone(),
            ],
        )?;

        // Now safe to mutably borrow game
        let game = &mut ctx.accounts.game;

        let mut won = false;
        let mut payout_multiplier = 0;

        match bet_type {
            BetType::Red => {
                if is_red(spin_result) {
                    won = true;
                    payout_multiplier = 2;
                }
            }
            BetType::Black => {
                if is_black(spin_result) {
                    won = true;
                    payout_multiplier = 2;
                }
            }
            BetType::Odd => {
                if spin_result != 0 && spin_result % 2 == 1 {
                    won = true;
                    payout_multiplier = 2;
                }
            }
            BetType::Even => {
                if spin_result != 0 && spin_result % 2 == 0 {
                    won = true;
                    payout_multiplier = 2;
                }
            }
            BetType::High => {
                if (19..=36).contains(&spin_result) {
                    won = true;
                    payout_multiplier = 2;
                }
            }
            BetType::Low => {
                if (1..=18).contains(&spin_result) {
                    won = true;
                    payout_multiplier = 2;
                }
            }
            BetType::Number => {
                if spin_result == bet_value {
                    won = true;
                    payout_multiplier = 36;
                }
            }
        }

        // Set game data
        game.player = player_key;
        game.bet_amount = bet_amount;
        game.bet_type = bet_type;
        game.bet_value = bet_value;
        game.spin_result = spin_result;
        game.won = won;
        game.is_finished = true;

        // Payout if player won
        if won {
            let payout = bet_amount
                .checked_mul(payout_multiplier)
                .ok_or(CustomError::Overflow)?;
            // Transfer payout from game to player using system program CPI
            let payout_ix = anchor_lang::solana_program::system_instruction::transfer(
                &game_key,
                &player_key,
                payout,
            );
            anchor_lang::solana_program::program::invoke(
                &payout_ix,
                &[
                    game_account_info.clone(),
                    player_account_info.clone(),
                    system_program_info.clone(),
                ],
            )?;
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct PlayRoulette<'info> {
    #[account(init, payer = player, space = 8 + RouletteGame::LEN)]
    pub game: Account<'info, RouletteGame>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct RouletteGame {
    pub player: Pubkey,
    pub bet_amount: u64,
    pub bet_type: BetType,
    pub bet_value: u8,
    pub spin_result: u8,
    pub won: bool,
    pub is_finished: bool,
}

impl RouletteGame {
    pub const LEN: usize = 32 + 8 + 1 + 1 + 1 + 1 + 1; // ~45
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum BetType {
    Red,
    Black,
    Odd,
    Even,
    High,
    Low,
    Number,
}

#[error_code]
pub enum CustomError {
    #[msg("Invalid bet amount")]
    InvalidBetAmount,
    #[msg("Invalid bet value")]
    InvalidBetValue,
    #[msg("Math overflow")]
    Overflow,
}

/// Helper functions for color mapping
fn is_red(number: u8) -> bool {
    matches!(
        number,
        1 | 3 | 5 | 7 | 9 | 12 | 14 | 16 | 18 | 19 | 21 | 23 | 25 | 27 | 30 | 32 | 34 | 36
    )
}

fn is_black(number: u8) -> bool {
    matches!(
        number,
        2 | 4 | 6 | 8 | 10 | 11 | 13 | 15 | 17 | 20 | 22 | 24 | 26 | 28 | 29 | 31 | 33 | 35
    )
}
