import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import { MinesGame } from "../target/types/mines";
import { assert } from "chai";

describe("mines", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Mines as Program<any>;

  let gameAccount: anchor.web3.Keypair;
  const player = provider.wallet;

  it("Starts a new game with 5 lamports", async () => {
    gameAccount = anchor.web3.Keypair.generate();

    await program.methods
      .startGame(new anchor.BN(5), 5) // ✅ 5 lamports bet, 5 mines
      .accounts({
        game: gameAccount.publicKey,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([gameAccount])
      .rpc();

    const game = await program.account.minesGame.fetch(gameAccount.publicKey);
    assert.ok(game.isActive);
    assert.equal(game.numMines, 5);
    assert.equal(game.betAmount.toNumber(), 5); // ✅ assert correct bet
  });

  it("Reveals a tile", async () => {
    await program.methods
      .revealTile(0)
      .accounts({
        game: gameAccount.publicKey,
        player: player.publicKey,
      })
      .rpc();

    const game = await program.account.minesGame.fetch(gameAccount.publicKey);
    assert.ok(game.revealedTiles[0]);
  });

  it("Cashes out", async () => {
    await program.methods
      .cashOut()
      .accounts({
        game: gameAccount.publicKey,
        player: player.publicKey,
      })
      .rpc();

    const game = await program.account.minesGame.fetch(gameAccount.publicKey);
    assert.ok(!game.isActive);
  });
});
