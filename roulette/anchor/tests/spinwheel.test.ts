import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { Spinwheel } from "../target/types/spinwheel";
import { expect } from "chai";

describe("spinwheel", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Spinwheel as Program<Spinwheel>;
  const authority = provider.wallet as anchor.Wallet;

  // PDAs
  let gameStatePda: web3.PublicKey;
  let houseVaultPda: web3.PublicKey;
  let gameStateBump: number;

  // Helper to confirm airdrop
  async function confirmAirdrop(publicKey: web3.PublicKey, amount: number) {
    const tx = await provider.connection.requestAirdrop(publicKey, amount);
    await provider.connection.confirmTransaction(tx);
  }

  beforeAll(async () => {
    // Find PDAs
    [gameStatePda, gameStateBump] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("game_state")],
      program.programId
    );
    [houseVaultPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("house_vault")],
      program.programId
    );
  });

  it("Initializes the game state", async () => {
    const houseEdge = 5;

    const tx = await program.methods
      .initialize(houseEdge)
      .accounts({
        gameState: gameStatePda,
        houseVault: houseVaultPda,
        authority: authority.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Initialize transaction signature:", tx);

    // Fetch and verify game state
    const gameStateAccount = await program.account.gameState.fetch(gameStatePda);
    expect(gameStateAccount.authority.toString()).to.equal(authority.publicKey.toString());
    expect(gameStateAccount.houseEdge).to.equal(houseEdge);
    expect(gameStateAccount.totalGames.toNumber()).to.equal(0);
    expect(gameStateAccount.totalWagered.toNumber()).to.equal(0);
    expect(gameStateAccount.totalPaidOut.toNumber()).to.equal(0);
    expect(gameStateAccount.isPaused).to.be.false;
    expect(gameStateAccount.minBet.toNumber()).to.equal(1_000_000); // 0.001 SOL
    expect(gameStateAccount.maxBet.toNumber()).to.equal(1_000_000_000); // 1 SOL
    expect(gameStateAccount.bump).to.equal(gameStateBump); // Verify bump
  });

  it("Funds the house vault", async () => {
    const fundAmount = new BN(10 * web3.LAMPORTS_PER_SOL); // 10 SOL

    const tx = await program.methods
      .fundHouseVault(fundAmount)
      .accounts({
        houseVault: houseVaultPda,
        funder: authority.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Fund house vault transaction signature:", tx);

    // Check house vault balance
    const houseVaultBalance = await provider.connection.getBalance(houseVaultPda);
    expect(houseVaultBalance).to.be.at.least(fundAmount.toNumber());
  });

  it("Places a spin", async () => {
    const player = web3.Keypair.generate();
    await confirmAirdrop(player.publicKey, 2 * web3.LAMPORTS_PER_SOL);

    const betAmount = new BN(100_000_000); // 0.1 SOL
    const prediction = 5;
    const initialPlayerBalance = await provider.connection.getBalance(player.publicKey);
    const initialVaultBalance = await provider.connection.getBalance(houseVaultPda);

    const tx = await program.methods
      .spin(betAmount, prediction)
      .accounts({
        gameState: gameStatePda,
        houseVault: houseVaultPda,
        player: player.publicKey,
        recentSlothashes: web3.SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([player])
      .rpc();

    console.log("Spin transaction signature:", tx);

    // Check updated game state
    const gameStateAccount = await program.account.gameState.fetch(gameStatePda);
    expect(gameStateAccount.totalGames.toNumber()).to.equal(1);
    expect(gameStateAccount.totalWagered.toNumber()).to.equal(betAmount.toNumber());

    // Check player and vault balances
    const finalPlayerBalance = await provider.connection.getBalance(player.publicKey);
    const finalVaultBalance = await provider.connection.getBalance(houseVaultPda);
    if (gameStateAccount.totalPaidOut.toNumber() > 0) {
      // Won: Verify payout
      const payout = gameStateAccount.totalPaidOut.toNumber();
      expect(finalVaultBalance).to.equal(initialVaultBalance - payout + betAmount.toNumber());
    } else {
      // Lost: Vault should have bet amount
      expect(finalVaultBalance).to.equal(initialVaultBalance + betAmount.toNumber());
    }
    expect(initialPlayerBalance - finalPlayerBalance).to.be.greaterThanOrEqual(betAmount.toNumber());
  });

  it("Places multiple spins and checks statistics", async () => {
    const player = web3.Keypair.generate();
    await confirmAirdrop(player.publicKey, 5 * web3.LAMPORTS_PER_SOL);

    const betAmount = new BN(50_000_000); // 0.05 SOL
    const initialGames = (await program.account.gameState.fetch(gameStatePda)).totalGames.toNumber();

    // Place 5 spins
    for (let i = 0; i < 5; i++) {
      const prediction = i % 8;
      try {
        const tx = await program.methods
          .spin(betAmount, prediction)
          .accounts({
            gameState: gameStatePda,
            houseVault: houseVaultPda,
            player: player.publicKey,
            recentSlothashes: web3.SYSVAR_SLOT_HASHES_PUBKEY,
            systemProgram: web3.SystemProgram.programId,
          })
          .signers([player])
          .rpc();
        console.log(`Spin ${i + 1} transaction:`, tx);
      } catch (error) {
        console.error(`Spin ${i + 1} failed:`, error);
      }
    }

    // Check final statistics
    const gameStateAccount = await program.account.gameState.fetch(gameStatePda);
    console.log("Final game statistics:");
    console.log("Total games:", gameStateAccount.totalGames.toNumber());
    console.log("Total wagered:", gameStateAccount.totalWagered.toNumber() / web3.LAMPORTS_PER_SOL, "SOL");
    console.log("Total paid out:", gameStateAccount.totalPaidOut.toNumber() / web3.LAMPORTS_PER_SOL, "SOL");
    expect(gameStateAccount.totalGames.toNumber()).to.equal(initialGames + 5);
    expect(gameStateAccount.totalWagered.toNumber()).to.equal(betAmount.toNumber() * 5 + 100_000_000); // Includes previous spin
  });

  it("Updates game settings", async () => {
    const newHouseEdge = 8;
    const newMinBet = new BN(500_000); // 0.0005 SOL
    const newMaxBet = new BN(2_000_000_000); // 2 SOL

    const tx = await program.methods
      .updateSettings(newHouseEdge, newMinBet, newMaxBet, false)
      .accounts({
        gameState: gameStatePda,
        authority: authority.publicKey,
      })
      .rpc();

    console.log("Update settings transaction signature:", tx);

    // Verify settings
    const gameStateAccount = await program.account.gameState.fetch(gameStatePda);
    expect(gameStateAccount.houseEdge).to.equal(newHouseEdge);
    expect(gameStateAccount.minBet.toNumber()).to.equal(newMinBet.toNumber());
    expect(gameStateAccount.maxBet.toNumber()).to.equal(newMaxBet.toNumber());
  });

  it("Pauses and unpauses the game", async () => {
    // Pause the game
    await program.methods
      .updateSettings(null, null, null, true)
      .accounts({
        gameState: gameStatePda,
        authority: authority.publicKey,
      })
      .rpc();

    let gameStateAccount = await program.account.gameState.fetch(gameStatePda);
    expect(gameStateAccount.isPaused).to.be.true;

    // Try to spin while paused
    const player = web3.Keypair.generate();
    await confirmAirdrop(player.publicKey, web3.LAMPORTS_PER_SOL);

    try {
      await program.methods
        .spin(new BN(500_000), 3)
        .accounts({
          gameState: gameStatePda,
          houseVault: houseVaultPda,
          player: player.publicKey,
          recentSlothashes: web3.SYSVAR_SLOT_HASHES_PUBKEY,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();
      expect.fail("Spin should have failed when game is paused");
    } catch (error) {
      expect(error.toString()).to.include("GamePaused");
    }

    // Unpause the game
    await program.methods
      .updateSettings(null, null, null, false)
      .accounts({
        gameState: gameStatePda,
        authority: authority.publicKey,
      })
      .rpc();

    gameStateAccount = await program.account.gameState.fetch(gameStatePda);
    expect(gameStateAccount.isPaused).to.be.false;
  });

  it("Withdraws house funds when paused", async () => {
    // Ensure game is paused
    await program.methods
      .updateSettings(null, null, null, true)
      .accounts({
        gameState: gameStatePda,
        authority: authority.publicKey,
      })
      .rpc();

    const initialAuthorityBalance = await provider.connection.getBalance(authority.publicKey);
    const houseVaultBalance = await provider.connection.getBalance(houseVaultPda);
    const withdrawAmount = new BN(Math.floor(houseVaultBalance / 2));

    const tx = await program.methods
      .withdrawHouseFunds(withdrawAmount)
      .accounts({
        gameState: gameStatePda,
        houseVault: houseVaultPda,
        authority: authority.publicKey,
      })
      .rpc();

    console.log("Withdraw house funds transaction signature:", tx);

    // Check balances
    const finalAuthorityBalance = await provider.connection.getBalance(authority.publicKey);
    const finalHouseVaultBalance = await provider.connection.getBalance(houseVaultPda);
    expect(finalHouseVaultBalance).to.equal(houseVaultBalance - withdrawAmount.toNumber());
    expect(finalAuthorityBalance).to.be.greaterThan(initialAuthorityBalance);
    console.log("Withdrew:", withdrawAmount.toNumber() / web3.LAMPORTS_PER_SOL, "SOL");
  });

  it("Fails to withdraw when not paused", async () => {
    // Ensure game is unpaused
    await program.methods
      .updateSettings(null, null, null, false)
      .accounts({
        gameState: gameStatePda,
        authority: authority.publicKey,
      })
      .rpc();

    try {
      await program.methods
        .withdrawHouseFunds(new BN(1_000_000))
        .accounts({
          gameState: gameStatePda,
          houseVault: houseVaultPda,
          authority: authority.publicKey,
        })
        .rpc();
      expect.fail("Should have failed with GameNotPaused");
    } catch (error) {
      expect(error.toString()).to.include("GameNotPaused");
    }
  });

  it("Fails with invalid bet amounts and prediction", async () => {
    const player = web3.Keypair.generate();
    await confirmAirdrop(player.publicKey, web3.LAMPORTS_PER_SOL);

    const gameStateAccount = await program.account.gameState.fetch(gameStatePda);

    // Test bet too low
    try {
      await program.methods
        .spin(new BN(gameStateAccount.minBet.toNumber() - 1), 0)
        .accounts({
          gameState: gameStatePda,
          houseVault: houseVaultPda,
          player: player.publicKey,
          recentSlothashes: web3.SYSVAR_SLOT_HASHES_PUBKEY,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();
      expect.fail("Should have failed with BetTooLow");
    } catch (error) {
      expect(error.toString()).to.include("BetTooLow");
    }

    // Test bet too high
    try {
      await program.methods
        .spin(new BN(gameStateAccount.maxBet.toNumber() + 1), 0)
        .accounts({
          gameState: gameStatePda,
          houseVault: houseVaultPda,
          player: player.publicKey,
          recentSlothashes: web3.SYSVAR_SLOT_HASHES_PUBKEY,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();
      expect.fail("Should have failed with BetTooHigh");
    } catch (error) {
      expect(error.toString()).to.include("BetTooHigh");
    }

    // Test invalid prediction
    try {
      await program.methods
        .spin(new BN(gameStateAccount.minBet.toNumber()), 8)
        .accounts({
          gameState: gameStatePda,
          houseVault: houseVaultPda,
          player: player.publicKey,
          recentSlothashes: web3.SYSVAR_SLOT_HASHES_PUBKEY,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();
      expect.fail("Should have failed with InvalidPrediction");
    } catch (error) {
      expect(error.toString()).to.include("InvalidPrediction");
    }
  });

  it("Fails to fund with zero amount", async () => {
    try {
      await program.methods
        .fundHouseVault(new BN(0))
        .accounts({
          houseVault: houseVaultPda,
          funder: authority.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have failed with InvalidAmount");
    } catch (error) {
      expect(error.toString()).to.include("InvalidAmount");
    }
  });
});