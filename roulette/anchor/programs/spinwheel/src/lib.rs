use anchor_lang::prelude::*;
use anchor_lang::system_program;
use arrayref::array_ref;

declare_id!("AbzPJiJqYBQNYrqgi2bfCiT19LB8BsesDrE5mWDbaePR");

#[program]
pub mod spinwheel {
    use super::*;

    /// Initializes the spin wheel game with given house edge
    pub fn initialize(ctx: Context<Initialize>, house_edge: u8) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        
        require!(house_edge <= 20, SpinWheelError::InvalidHouseEdge);
        
        game_state.authority = ctx.accounts.authority.key();
        game_state.house_edge = house_edge;
        game_state.total_games = 0;
        game_state.total_wagered = 0;
        game_state.total_paid_out = 0;
        game_state.is_paused = false;
        game_state.min_bet = 1_000_000; // 0.001 SOL in lamports
        game_state.max_bet = 1_000_000_000; // 1 SOL in lamports
        game_state.bump = ctx.bumps.game_state; // Store bump for PDA validation
        
        msg!("Spin wheel initialized with house edge: {}%", house_edge);
        Ok(())
    }

    /// Executes a spin with a bet and prediction
    pub fn spin(ctx: Context<Spin>, bet_amount: u64, prediction: u8) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        
        // Validation checks
        require!(!game_state.is_paused, SpinWheelError::GamePaused);
        require!(bet_amount >= game_state.min_bet, SpinWheelError::BetTooLow);
        require!(bet_amount <= game_state.max_bet, SpinWheelError::BetTooHigh);
        require!(prediction < 8, SpinWheelError::InvalidPrediction); // 8 segments (0-7)
        
        // Ensure house vault can cover the worst-case payout after receiving the bet
        let min_rent_balance = Rent::get()?.minimum_balance(8);
        let base_payout = bet_amount
            .checked_mul(8)
            .ok_or(SpinWheelError::ArithmeticOverflow)?;
        let house_cut = base_payout
            .checked_mul(game_state.house_edge as u64)
            .ok_or(SpinWheelError::ArithmeticOverflow)?
            / 100;
        let max_possible_payout = base_payout
            .checked_sub(house_cut)
            .ok_or(SpinWheelError::ArithmeticOverflow)?;
        let projected_vault_balance = ctx
            .accounts
            .house_vault
            .lamports()
            .saturating_add(bet_amount);
        require!(
            projected_vault_balance.saturating_sub(max_possible_payout) >= min_rent_balance,
            SpinWheelError::InsufficientHouseFunds
        );

        // Transfer bet to house vault
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.house_vault.to_account_info(),
                },
            ),
            bet_amount,
        )?;
        
        // Generate pseudo-random number with improved seed
        let recent_slothashes = &ctx.accounts.recent_slothashes;
        let data = recent_slothashes.data.borrow();
        let most_recent = array_ref![data, 12, 8];
        
        let clock = Clock::get()?;
        let seed = u64::from_le_bytes(*most_recent)
            .wrapping_add(clock.slot)
            .wrapping_add(clock.unix_timestamp as u64)
            .wrapping_add(bet_amount)
            .wrapping_add(ctx.accounts.player.key().to_bytes()[0] as u64); // Add player pubkey byte
        
        let result = (seed % 8) as u8;
        
        // Calculate payout
        let (payout, is_winner) = if result == prediction {
            // Pay 8x on win so the player effectively receives 7x profit + original stake back
            let base_payout = bet_amount.checked_mul(8).ok_or(SpinWheelError::ArithmeticOverflow)?;
            let house_cut = base_payout
                .checked_mul(game_state.house_edge as u64)
                .ok_or(SpinWheelError::ArithmeticOverflow)?
                / 100;
            let final_payout = base_payout
                .checked_sub(house_cut)
                .ok_or(SpinWheelError::ArithmeticOverflow)?;
            (final_payout, true)
        } else {
            (0, false)
        };
        
        // Update game statistics
        game_state.total_games = game_state.total_games.saturating_add(1);
        game_state.total_wagered = game_state.total_wagered.saturating_add(bet_amount);
        
        // Pay out winnings if applicable
        if is_winner && payout > 0 {
            let house_balance = ctx.accounts.house_vault.lamports();
            let min_rent_balance = Rent::get()?.minimum_balance(8);
            require!(
                house_balance.saturating_sub(payout) >= min_rent_balance,
                SpinWheelError::InsufficientHouseFunds
            );
            
            **ctx.accounts.house_vault.to_account_info().try_borrow_mut_lamports()? -= payout;
            **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += payout;
            
            game_state.total_paid_out = game_state.total_paid_out.saturating_add(payout);
        }
        
        // Emit game result event
        emit!(SpinResult {
            player: ctx.accounts.player.key(),
            bet_amount,
            prediction,
            result,
            payout,
            is_winner,
            timestamp: clock.unix_timestamp,
            house_edge: game_state.house_edge, // Added house edge to event
        });
        
        msg!(
            "Spin result: Player bet {} on {}, wheel landed on {}. {}",
            bet_amount,
            prediction,
            result,
            if is_winner { 
                format!("Won {} lamports!", payout) 
            } else { 
                "Lost!".to_string() 
            }
        );
        
        Ok(())
    }
    
    /// Updates game settings (house edge, bet limits, pause state)
    pub fn update_settings(
        ctx: Context<UpdateSettings>, 
        house_edge: Option<u8>,
        min_bet: Option<u64>,
        max_bet: Option<u64>,
        is_paused: Option<bool>,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        
        if let Some(edge) = house_edge {
            require!(edge <= 20, SpinWheelError::InvalidHouseEdge);
            game_state.house_edge = edge;
        }
        
        // Apply min/max updates atomically to avoid invalid states
        if min_bet.is_some() || max_bet.is_some() {
            let new_min = min_bet.unwrap_or(game_state.min_bet);
            let new_max = max_bet.unwrap_or(game_state.max_bet);
            require!(new_min > 0, SpinWheelError::InvalidBetRange);
            require!(new_max >= new_min, SpinWheelError::InvalidBetRange);
            game_state.min_bet = new_min;
            game_state.max_bet = new_max;
        }
        
        if let Some(paused) = is_paused {
            game_state.is_paused = paused;
        }
        
        msg!("Settings updated: house_edge={:?}, min_bet={:?}, max_bet={:?}, is_paused={:?}",
            house_edge, min_bet, max_bet, is_paused);
        Ok(())
    }
    
    /// Withdraws funds from house vault (only when paused)
    pub fn withdraw_house_funds(ctx: Context<WithdrawHouseFunds>, amount: u64) -> Result<()> {
        let game_state = &ctx.accounts.game_state;
        require!(game_state.is_paused, SpinWheelError::GameNotPaused); // Added pause check
        require!(amount > 0, SpinWheelError::InvalidAmount);
        
        let house_balance = ctx.accounts.house_vault.lamports();
        let min_rent_balance = Rent::get()?.minimum_balance(8);
        require!(
            house_balance.saturating_sub(amount) >= min_rent_balance,
            SpinWheelError::InsufficientHouseFunds
        );
        
        **ctx.accounts.house_vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += amount;
        
        msg!("Withdrew {} lamports from house vault", amount);
        Ok(())
    }
    
    /// Funds the house vault
    pub fn fund_house_vault(ctx: Context<FundHouseVault>, amount: u64) -> Result<()> {
        require!(amount > 0, SpinWheelError::InvalidAmount);
        
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.funder.to_account_info(),
                    to: ctx.accounts.house_vault.to_account_info(),
                },
            ),
            amount,
        )?;
        
        msg!("Funded house vault with {} lamports", amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GameState::LEN, // Explicitly include discriminator
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        init,
        payer = authority,
        space = 8, // Minimal space for system account
        seeds = [b"house_vault"],
        bump
    )]
    /// CHECK: Program-owned PDA vault (lamports-only)
    pub house_vault: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Spin<'info> {
    #[account(
        mut,
        seeds = [b"game_state"],
        bump = game_state.bump // Validate bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        mut,
        seeds = [b"house_vault"],
        bump
    )]
    /// CHECK: Program-owned PDA vault (lamports-only)
    pub house_vault: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub player: Signer<'info>,
    
    /// CHECK: Sysvar for slot hashes
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::id())]
    pub recent_slothashes: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateSettings<'info> {
    #[account(
        mut,
        seeds = [b"game_state"],
        bump = game_state.bump, // Validate bump
        constraint = game_state.authority == authority.key()
    )]
    pub game_state: Account<'info, GameState>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawHouseFunds<'info> {
    #[account(
        seeds = [b"game_state"],
        bump = game_state.bump // Validate bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        mut,
        seeds = [b"house_vault"],
        bump
    )]
    /// CHECK: Program-owned PDA vault (lamports-only)
    pub house_vault: UncheckedAccount<'info>,
    
    #[account(mut, constraint = game_state.authority == authority.key())]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct FundHouseVault<'info> {
    #[account(
        mut,
        seeds = [b"house_vault"],
        bump
    )]
    /// CHECK: Program-owned PDA vault (lamports-only)
    pub house_vault: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub funder: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[account]
pub struct GameState {
    pub authority: Pubkey,
    pub house_edge: u8,           // Percentage (0-20%)
    pub total_games: u64,
    pub total_wagered: u64,
    pub total_paid_out: u64,
    pub is_paused: bool,
    pub min_bet: u64,
    pub max_bet: u64,
    pub bump: u8,                // Store PDA bump
}

impl GameState {
    pub const LEN: usize = 32 +  // authority
        1 +   // house_edge
        8 +   // total_games
        8 +   // total_wagered
        8 +   // total_paid_out
        1 +   // is_paused
        8 +   // min_bet
        8 +   // max_bet
        1;    // bump
}

#[event]
pub struct SpinResult {
    pub player: Pubkey,
    pub bet_amount: u64,
    pub prediction: u8,
    pub result: u8,
    pub payout: u64,
    pub is_winner: bool,
    pub timestamp: i64,
    pub house_edge: u8, // Added for transparency
}

#[error_code]
pub enum SpinWheelError {
    #[msg("Invalid house edge. Must be between 0-20%")]
    InvalidHouseEdge,
    #[msg("Game is currently paused")]
    GamePaused,
    #[msg("Bet amount is too low")]
    BetTooLow,
    #[msg("Bet amount is too high")]
    BetTooHigh,
    #[msg("Invalid prediction. Must be between 0-7")]
    InvalidPrediction,
    #[msg("Insufficient house funds for payout")]
    InsufficientHouseFunds,
    #[msg("Invalid bet range. Max bet must be >= min bet")]
    InvalidBetRange,
    #[msg("Invalid amount specified")]
    InvalidAmount,
    #[msg("Game must be paused for this operation")]
    GameNotPaused,
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
}