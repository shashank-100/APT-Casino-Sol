import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Roulette } from "../target/types/roulette";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, mintTo, getOrCreateAssociatedTokenAccount, approve } from "@solana/spl-token";
import assert from "assert";

describe("roulette", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Roulette as Program<Roulette>;
  const provider = anchor.getProvider();
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();
  const treasury = Keypair.generate();
  let gameState: PublicKey;
  let vaultToken: PublicKey;
  let tokenMint: PublicKey;
  let player1Token: PublicKey;
  let player2Token: PublicKey;
  let treasuryToken: PublicKey;
  const minBet = BigInt(1_000_000_000_000_000_000); // 1 token (18 decimals)
  const betAmount = BigInt(2_000_000_000_000_000_000); // 2 tokens
  const maxBet = BigInt(1_000_000_000_000_000_000_000); // 1000 tokens

  before(async () => {
    // Fund players and treasury
    await provider.connection.requestAirdrop(player1.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(player2.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(treasury.publicKey, 2 * LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create token mint and accounts
    tokenMint = await createMint(provider.connection, player1, player1.publicKey, null, 18);
    player1Token = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      player1,
      tokenMint,
      player1.publicKey
    )).address;
    player2Token = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      player1,
      tokenMint,
      player2.publicKey
    )).address;
    treasuryToken = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      player1,
      tokenMint,
      treasury.publicKey
    )).address;
    vaultToken = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      player1,
      tokenMint,
      (await PublicKey.findProgramAddress([Buffer.from("VAULT")], program.programId))[0]
    )).address;

    // Mint tokens
    await mintTo(provider.connection, player1, tokenMint, player1Token, player1, 1000_000_000_000_000_000_000); // 1000 tokens
    await mintTo(provider.connection, player1, tokenMint, player2Token, player1, 1000_000_000_000_000_000_000); // 1000 tokens
    await mintTo(provider.connection, player1, tokenMint, vaultToken, player1, 1000_000_000_000_000_000_000); // 1000 tokens for payouts

    // Approve vault_token as delegate
    await approve(provider.connection, player1, player1Token, vaultToken, player1, betAmount * BigInt(10));
    await approve(provider.connection, player1, player2Token, vaultToken, player2, betAmount * BigInt(10));

    [gameState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("GAME")],
      program.programId
    );
  });

  it("Initializes game state", async () => {
    await program.methods
      .initialize(new anchor.BN(minBet), treasury.publicKey, tokenMint)
      .accounts({
        player: player1.publicKey,
        game_state: gameState,
        vault_token: vaultToken,
        token_mint: tokenMint,
        system_program: SystemProgram.programId,
        token_program: TOKEN_PROGRAM_ID,
      })
      .signers([player1])
      .rpc();

    const gameStateData = await program.account.gameState.fetch(gameState);
    assert.equal(gameStateData.minBet.toString(), minBet.toString());
    assert.equal(gameStateData.treasury.toBase58(), treasury.publicKey.toBase58());
    assert.equal(gameStateData.tokenMint.toBase58(), tokenMint.toBase58());
    assert.equal(gameStateData.round.toNumber(), 1);
    assert.equal(gameStateData.bets.length, 0);
    assert.equal(gameStateData.nonce.toNumber(), 0);
    assert.equal(gameStateData.lastSlot.toNumber(), 0);
    assert.equal(gameStateData.randomResult.toNumber(), 0);
  });

  it("Places bets from multiple players and processes immediately", async () => {
    const betType = 0; // Number
    const betValue = 17;
    const numbers: number[] = [];

    const initialVaultBalance = (await provider.connection.getTokenAccountBalance(vaultToken)).value.amount;
    const initialPlayer1Balance = (await provider.connection.getTokenAccountBalance(player1Token)).value.amount;
    const initialPlayer2Balance = (await provider.connection.getTokenAccountBalance(player2Token)).value.amount;
    const initialTreasuryBalance = (await provider.connection.getTokenAccountBalance(treasuryToken)).value.amount;

    // Player 1 bets
    await program.methods
      .placeBet(betType, betValue, numbers, new anchor.BN(betAmount))
      .accounts({
        player: player1.publicKey,
        game_state: gameState,
        vault_token: vaultToken,
        player_token: player1Token,
        treasury_token: treasuryToken,
        player_bet_time: (await PublicKey.findProgramAddress(
          [Buffer.from("LAST_BET"), player1.publicKey.toBuffer()],
          program.programId
        ))[0],
        recent_blockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        system_program: SystemProgram.programId,
        token_program: TOKEN_PROGRAM_ID,
      })
      .signers([player1])
      .rpc();

    // Player 2 bets
    await program.methods
      .placeBet(betType, betValue, numbers, new anchor.BN(betAmount))
      .accounts({
        player: player2.publicKey,
        game_state: gameState,
        vault_token: vaultToken,
        player_token: player2Token,
        treasury_token: treasuryToken,
        player_bet_time: (await PublicKey.findProgramAddress(
          [Buffer.from("LAST_BET"), player2.publicKey.toBuffer()],
          program.programId
        ))[0],
        recent_blockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        system_program: SystemProgram.programId,
        token_program: TOKEN_PROGRAM_ID,
      })
      .signers([player2])
      .rpc();

    const gameStateData = await program.account.gameState.fetch(gameState);
    const finalVaultBalance = (await provider.connection.getTokenAccountBalance(vaultToken)).value.amount;
    const finalPlayer1Balance = (await provider.connection.getTokenAccountBalance(player1Token)).value.amount;
    const finalPlayer2Balance = (await provider.connection.getTokenAccountBalance(player2Token)).value.amount;
    const finalTreasuryBalance = (await provider.connection.getTokenAccountBalance(treasuryToken)).value.amount;

    assert.equal(gameStateData.bets.length, 0, "Bets should be cleared");
    assert.equal(gameStateData.round.toNumber(), 3, "Round should increment twice");
    assert.equal(gameStateData.nonce.toNumber(), 2, "Nonce should increment twice");
    assert.notEqual(gameStateData.randomResult.toNumber(), 0, "Random result should be set");
    assert.notEqual(finalVaultBalance, initialVaultBalance, "Vault balance should change");
    assert.notEqual(finalTreasuryBalance, initialTreasuryBalance, "Treasury balance should change");
    assert.notEqual(finalPlayer1Balance, initialPlayer1Balance, "Player 1 balance should change");
    // Player 2 balance may not change (if not paid out), but bet is processed
  });

  it("Places a color bet and enforces cooldown", async () => {
    const betType = 1; // Color
    const betValue = 0; // Red
    const numbers: number[] = [];

    await program.methods
      .placeBet(betType, betValue, numbers, new anchor.BN(betAmount))
      .accounts({
        player: player1.publicKey,
        game_state: gameState,
        vault_token: vaultToken,
        player_token: player1Token,
        treasury_token: treasuryToken,
        player_bet_time: (await PublicKey.findProgramAddress(
          [Buffer.from("LAST_BET"), player1.publicKey.toBuffer()],
          program.programId
        ))[0],
        recent_blockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        system_program: SystemProgram.programId,
        token_program: TOKEN_PROGRAM_ID,
      })
      .signers([player1])
      .rpc();

    // Try betting again immediately (should fail due to cooldown)
    await assert.rejects(
      program.methods
        .placeBet(betType, betValue, numbers, new anchor.BN(betAmount))
        .accounts({
          player: player1.publicKey,
          game_state: gameState,
          vault_token: vaultToken,
          player_token: player1Token,
          treasury_token: treasuryToken,
          player_bet_time: (await PublicKey.findProgramAddress(
            [Buffer.from("LAST_BET"), player1.publicKey.toBuffer()],
            program.programId
          ))[0],
          recent_blockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
          system_program: SystemProgram.programId,
          token_program: TOKEN_PROGRAM_ID,
        })
        .signers([player1])
        .rpc(),
      /CooldownNotMet/,
      "Should enforce 3-second cooldown"
    );

    const gameStateData = await program.account.gameState.fetch(gameState);
    assert.equal(gameStateData.bets.length, 0, "Bets should be cleared");
    assert.equal(gameStateData.round.toNumber(), 4, "Round should increment");
  });

  it("Fails on insufficient balance", async () => {
    const betType = 0; // Number
    const betValue = 17;
    const numbers: number[] = [];
    const largeBet = BigInt(2_000_000_000_000_000_000_000); // 2000 tokens (exceeds balance)

    await assert.rejects(
      program.methods
        .placeBet(betType, betValue, numbers, new anchor.BN(largeBet))
        .accounts({
          player: player1.publicKey,
          game_state: gameState,
          vault_token: vaultToken,
          player_token: player1Token,
          treasury_token: treasuryToken,
          player_bet_time: (await PublicKey.findProgramAddress(
            [Buffer.from("LAST_BET"), player1.publicKey.toBuffer()],
            program.programId
          ))[0],
          recent_blockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
          system_program: SystemProgram.programId,
          token_program: TOKEN_PROGRAM_ID,
        })
        .signers([player1])
        .rpc(),
      /InsufficientBalance/,
      "Should fail on insufficient balance"
    );
  });

  it("Fails on invalid bet type", async () => {
    const betType = 10; // Invalid
    const betValue = 0;
    const numbers: number[] = [];

    await assert.rejects(
      program.methods
        .placeBet(betType, betValue, numbers, new anchor.BN(betAmount))
        .accounts({
          player: player1.publicKey,
          game_state: gameState,
          vault_token: vaultToken,
          player_token: player1Token,
          treasury_token: treasuryToken,
          player_bet_time: (await PublicKey.findProgramAddress(
            [Buffer.from("LAST_BET"), player1.publicKey.toBuffer()],
            program.programId
          ))[0],
          recent_blockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
          system_program: SystemProgram.programId,
          token_program: TOKEN_PROGRAM_ID,
        })
        .signers([player1])
        .rpc(),
      /InvalidBet/,
      "Should fail on invalid bet type"
    );
  });

  it("Fails on below minimum bet", async () => {
    const betType = 0;
    const betValue = 17;
    const numbers: number[] = [];
    const smallBet = minBet / BigInt(2); // Below minimum

    await assert.rejects(
      program.methods
        .placeBet(betType, betValue, numbers, new anchor.BN(smallBet))
        .accounts({
          player: player1.publicKey,
          game_state: gameState,
          vault_token: vaultToken,
          player_token: player1Token,
          treasury_token: treasuryToken,
          player_bet_time: (await PublicKey.findProgramAddress(
            [Buffer.from("LAST_BET"), player1.publicKey.toBuffer()],
            program.programId
          ))[0],
          recent_blockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
          system_program: SystemProgram.programId,
          token_program: TOKEN_PROGRAM_ID,
        })
        .signers([player1])
        .rpc(),
      /InvalidBetAmount/,
      "Should fail on below minimum bet"
    );
  });

  it("Fails on above maximum bet", async () => {
    const betType = 0;
    const betValue = 17;
    const numbers: number[] = [];
    const largeBet = maxBet * BigInt(2); // Above maximum

    await assert.rejects(
      program.methods
        .placeBet(betType, betValue, numbers, new anchor.BN(largeBet))
        .accounts({
          player: player1.publicKey,
          game_state: gameState,
          vault_token: vaultToken,
          player_token: player1Token,
          treasury_token: treasuryToken,
          player_bet_time: (await PublicKey.findProgramAddress(
            [Buffer.from("LAST_BET"), player1.publicKey.toBuffer()],
            program.programId
          ))[0],
          recent_blockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
          system_program: SystemProgram.programId,
          token_program: TOKEN_PROGRAM_ID,
        })
        .signers([player1])
        .rpc(),
      /InvalidBetAmount/,
      "Should fail on above maximum bet"
    );
  });

  it("Sets minimum bet", async () => {
    const newMinBet = minBet * BigInt(2);
    await program.methods
      .setMinBet(new anchor.BN(newMinBet))
      .accounts({
        admin: treasury.publicKey,
        game_state: gameState,
      })
      .signers([treasury])
      .rpc();

    const gameStateData = await program.account.gameState.fetch(gameState);
    assert.equal(gameStateData.minBet.toString(), newMinBet.toString(), "Minimum bet should be updated");
  });

  it("Fails set minimum bet by non-treasury", async () => {
    const newMinBet = minBet * BigInt(3);
    await assert.rejects(
      program.methods
        .setMinBet(new anchor.BN(newMinBet))
        .accounts({
          admin: player1.publicKey,
          game_state: gameState,
        })
        .signers([player1])
        .rpc(),
      /Unauthorized/,
      "Should fail if non-treasury tries to set minimum bet"
    );
  });

  it("Withdraws tokens", async () => {
    const amount = minBet;
    const initialVaultBalance = (await provider.connection.getTokenAccountBalance(vaultToken)).value.amount;
    const initialTreasuryBalance = (await provider.connection.getTokenAccountBalance(treasuryToken)).value.amount;

    await program.methods
      .withdrawTokens(new anchor.BN(amount))
      .accounts({
        admin: treasury.publicKey,
        game_state: gameState,
        vault_token: vaultToken,
        treasury_token: treasuryToken,
        token_program: TOKEN_PROGRAM_ID,
      })
      .signers([treasury])
      .rpc();

    const finalVaultBalance = (await provider.connection.getTokenAccountBalance(vaultToken)).value.amount;
    const finalTreasuryBalance = (await provider.connection.getTokenAccountBalance(treasuryToken)).value.amount;
    assert.equal(finalVaultBalance, (BigInt(initialVaultBalance) - amount).toString(), "Vault balance should decrease");
    assert.equal(finalTreasuryBalance, (BigInt(initialTreasuryBalance) + amount).toString(), "Treasury balance should increase");
  });

  it("Fails withdraw tokens by non-treasury", async () => {
    const amount = minBet;
    await assert.rejects(
      program.methods
        .withdrawTokens(new anchor.BN(amount))
        .accounts({
          admin: player1.publicKey,
          game_state: gameState,
          vault_token: vaultToken,
          treasury_token: treasuryToken,
          token_program: TOKEN_PROGRAM_ID,
        })
        .signers([player1])
        .rpc(),
      /Unauthorized/,
      "Should fail if non-treasury tries to withdraw tokens"
    );
  });

  it("Requests allowance", async () => {
    const amount = minBet;
    await program.methods
      .requestAllowance(new anchor.BN(amount))
      .accounts({
        player: player1.publicKey,
        game_state: gameState,
      })
      .signers([player1])
      .rpc();
    // Event verification requires parsing transaction logs, assume success if no error
  });
});
