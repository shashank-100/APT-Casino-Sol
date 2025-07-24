import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Roulette } from "../target/types/roulette";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("roulette", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Roulette as Program<Roulette>;
  const provider = anchor.getProvider();

  let player: Keypair;
  let gameAccount: Keypair;

  beforeEach(async () => {
    // Create a new player for each test
    player = Keypair.generate();
    gameAccount = Keypair.generate();

    // Airdrop SOL to player
    const signature = await provider.connection.requestAirdrop(
      player.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);
  });

  describe("Red/Black Bets", () => {
    it("Should handle a winning red bet", async () => {
      const betAmount = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL
      
      const initialPlayerBalance = await provider.connection.getBalance(player.publicKey);
      
      await program.methods
        .playRoulette(
          new anchor.BN(betAmount),
          { red: {} },
          0 // bet_value doesn't matter for red/black bets
        )
        .accounts({
          game: gameAccount.publicKey,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player, gameAccount])
        .rpc();

      // Fetch the game state
      const gameState = await program.account.rouletteGame.fetch(gameAccount.publicKey);
      
      expect(gameState.player.toString()).to.equal(player.publicKey.toString());
      expect(gameState.betAmount.toNumber()).to.equal(betAmount);
      expect(gameState.betType).to.deep.equal({ red: {} });
      expect(gameState.isFinished).to.be.true;
      expect(gameState.spinResult).to.be.at.least(0).and.at.most(36);

      // Check if the result matches the win condition
      const isRedNumber = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]
        .includes(gameState.spinResult);
      
      expect(gameState.won).to.equal(isRedNumber);

      const finalPlayerBalance = await provider.connection.getBalance(player.publicKey);
      
      if (gameState.won) {
        // Player should have received 2x bet amount (original bet + winnings)
        // But we need to account for transaction fees
        expect(finalPlayerBalance).to.be.greaterThan(initialPlayerBalance - betAmount);
      } else {
        // Player should have lost the bet amount (plus transaction fees)
        expect(finalPlayerBalance).to.be.lessThan(initialPlayerBalance - betAmount);
      }
    });

    it("Should handle a black bet", async () => {
      const betAmount = 0.05 * LAMPORTS_PER_SOL;
      
      await program.methods
        .playRoulette(
          new anchor.BN(betAmount),
          { black: {} },
          0
        )
        .accounts({
          game: gameAccount.publicKey,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player, gameAccount])
        .rpc();

      const gameState = await program.account.rouletteGame.fetch(gameAccount.publicKey);
      
      expect(gameState.betType).to.deep.equal({ black: {} });
      
      const isBlackNumber = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35]
        .includes(gameState.spinResult);
      
      expect(gameState.won).to.equal(isBlackNumber);
    });
  });

  describe("Odd/Even Bets", () => {
    it("Should handle an odd bet", async () => {
      const betAmount = 0.2 * LAMPORTS_PER_SOL;
      
      await program.methods
        .playRoulette(
          new anchor.BN(betAmount),
          { odd: {} },
          0
        )
        .accounts({
          game: gameAccount.publicKey,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player, gameAccount])
        .rpc();

      const gameState = await program.account.rouletteGame.fetch(gameAccount.publicKey);
      
      expect(gameState.betType).to.deep.equal({ odd: {} });
      
      const isOdd = gameState.spinResult !== 0 && gameState.spinResult % 2 === 1;
      expect(gameState.won).to.equal(isOdd);
    });

    it("Should handle an even bet", async () => {
      const betAmount = 0.15 * LAMPORTS_PER_SOL;
      
      await program.methods
        .playRoulette(
          new anchor.BN(betAmount),
          { even: {} },
          0
        )
        .accounts({
          game: gameAccount.publicKey,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player, gameAccount])
        .rpc();

      const gameState = await program.account.rouletteGame.fetch(gameAccount.publicKey);
      
      expect(gameState.betType).to.deep.equal({ even: {} });
      
      const isEven = gameState.spinResult !== 0 && gameState.spinResult % 2 === 0;
      expect(gameState.won).to.equal(isEven);
    });
  });

  describe("High/Low Bets", () => {
    it("Should handle a high bet (19-36)", async () => {
      const betAmount = 0.08 * LAMPORTS_PER_SOL;
      
      await program.methods
        .playRoulette(
          new anchor.BN(betAmount),
          { high: {} },
          0
        )
        .accounts({
          game: gameAccount.publicKey,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player, gameAccount])
        .rpc();

      const gameState = await program.account.rouletteGame.fetch(gameAccount.publicKey);
      
      expect(gameState.betType).to.deep.equal({ high: {} });
      
      const isHigh = gameState.spinResult >= 19 && gameState.spinResult <= 36;
      expect(gameState.won).to.equal(isHigh);
    });

    it("Should handle a low bet (1-18)", async () => {
      const betAmount = 0.12 * LAMPORTS_PER_SOL;
      
      await program.methods
        .playRoulette(
          new anchor.BN(betAmount),
          { low: {} },
          0
        )
        .accounts({
          game: gameAccount.publicKey,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player, gameAccount])
        .rpc();

      const gameState = await program.account.rouletteGame.fetch(gameAccount.publicKey);
      
      expect(gameState.betType).to.deep.equal({ low: {} });
      
      const isLow = gameState.spinResult >= 1 && gameState.spinResult <= 18;
      expect(gameState.won).to.equal(isLow);
    });
  });

  describe("Number Bets", () => {
    it("Should handle a specific number bet", async () => {
      const betAmount = 0.01 * LAMPORTS_PER_SOL;
      const betNumber = 17;
      
      const initialPlayerBalance = await provider.connection.getBalance(player.publicKey);
      
      await program.methods
        .playRoulette(
          new anchor.BN(betAmount),
          { number: {} },
          betNumber
        )
        .accounts({
          game: gameAccount.publicKey,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player, gameAccount])
        .rpc();

      const gameState = await program.account.rouletteGame.fetch(gameAccount.publicKey);
      
      expect(gameState.betType).to.deep.equal({ number: {} });
      expect(gameState.betValue).to.equal(betNumber);
      
      const wonNumber = gameState.spinResult === betNumber;
      expect(gameState.won).to.equal(wonNumber);

      const finalPlayerBalance = await provider.connection.getBalance(player.publicKey);
      
      if (gameState.won) {
        // Player should have received 36x bet amount for a winning number bet
        // But we need to account for transaction fees
        expect(finalPlayerBalance).to.be.greaterThan(initialPlayerBalance + (betAmount * 35)); // 35x profit
      }
    });

    it("Should reject invalid number bets", async () => {
      const betAmount = 0.01 * LAMPORTS_PER_SOL;
      const invalidBetNumber = 37; // Should be <= 36
      
      try {
        await program.methods
          .playRoulette(
            new anchor.BN(betAmount),
            { number: {} },
            invalidBetNumber
          )
          .accounts({
            game: gameAccount.publicKey,
            player: player.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player, gameAccount])
          .rpc();
        
        expect.fail("Should have thrown an error for invalid bet value");
      } catch (error) {
        expect(error.error.errorMessage).to.include("Invalid bet value");
      }
    });
  });

  describe("Error Cases", () => {
    it("Should reject zero bet amount", async () => {
      try {
        await program.methods
          .playRoulette(
            new anchor.BN(0),
            { red: {} },
            0
          )
          .accounts({
            game: gameAccount.publicKey,
            player: player.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player, gameAccount])
          .rpc();
        
        expect.fail("Should have thrown an error for zero bet amount");
      } catch (error) {
        expect(error.error.errorMessage).to.include("Invalid bet amount");
      }
    });

    it("Should fail if player has insufficient funds", async () => {
      // Create a player with very little SOL
      const poorPlayer = Keypair.generate();
      const poorGameAccount = Keypair.generate();
      
      // Give just enough SOL for transaction fees but not for the bet
      const signature = await provider.connection.requestAirdrop(
        poorPlayer.publicKey,
        0.001 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature);

      const largeBetAmount = 1 * LAMPORTS_PER_SOL; // 1 SOL bet
      
      try {
        await program.methods
          .playRoulette(
            new anchor.BN(largeBetAmount),
            { red: {} },
            0
          )
          .accounts({
            game: poorGameAccount.publicKey,
            player: poorPlayer.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([poorPlayer, poorGameAccount])
          .rpc();
        
        expect.fail("Should have failed due to insufficient funds");
      } catch (error) {
        // This should fail at the system program level due to insufficient funds
        expect(error).to.exist;
      }
    });
  });

  describe("Game State Verification", () => {
    it("Should properly set all game state fields", async () => {
      const betAmount = 0.05 * LAMPORTS_PER_SOL;
      const betNumber = 25;
      
      await program.methods
        .playRoulette(
          new anchor.BN(betAmount),
          { number: {} },
          betNumber
        )
        .accounts({
          game: gameAccount.publicKey,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player, gameAccount])
        .rpc();

      const gameState = await program.account.rouletteGame.fetch(gameAccount.publicKey);
      
      // Verify all fields are set correctly
      expect(gameState.player.toString()).to.equal(player.publicKey.toString());
      expect(gameState.betAmount.toNumber()).to.equal(betAmount);
      expect(gameState.betType).to.deep.equal({ number: {} });
      expect(gameState.betValue).to.equal(betNumber);
      expect(gameState.spinResult).to.be.at.least(0).and.at.most(36);
      expect(gameState.isFinished).to.be.true;
      
      // Verify win condition
      const shouldWin = gameState.spinResult === betNumber;
      expect(gameState.won).to.equal(shouldWin);
    });
  });

  describe("Multiple Games", () => {
    it("Should allow multiple games with different accounts", async () => {
      const betAmount = 0.02 * LAMPORTS_PER_SOL;
      
      // First game
      const gameAccount1 = Keypair.generate();
      await program.methods
        .playRoulette(
          new anchor.BN(betAmount),
          "red",
          0
        )
        .accounts({
          game: gameAccount1.publicKey,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player, gameAccount1])
        .rpc();

      // Second game
      const gameAccount2 = Keypair.generate();
      await program.methods
        .playRoulette(
          new anchor.BN(betAmount),
          "black",
          0
        )
        .accounts({
          game: gameAccount2.publicKey,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player, gameAccount2])
        .rpc();

      // Verify both games exist and have correct data
      const gameState1 = await program.account.rouletteGame.fetch(gameAccount1.publicKey);
      const gameState2 = await program.account.rouletteGame.fetch(gameAccount2.publicKey);
      
      expect(gameState1.betType).to.deep.equal({ red: {} });
      expect(gameState2.betType).to.deep.equal({ black: {} });
      expect(gameState1.isFinished).to.be.true;
      expect(gameState2.isFinished).to.be.true;
    });
  });
});