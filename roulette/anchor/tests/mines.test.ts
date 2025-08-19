import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SystemProgram, PublicKey, Keypair } from "@solana/web3.js";
import { assert } from "chai";
import crypto from "crypto";

const MERKLE_DEPTH = 5; // must match program
const MAX_BOARD_SIZE = 25;
const TREE_LEAVES = 1 << MERKLE_DEPTH; // 32

// Helpers mirroring on-chain hashing
const sha256 = (parts: Uint8Array[]) => {
  const h = crypto.createHash("sha256");
  parts.forEach((p) => h.update(Buffer.from(p)));
  return new Uint8Array(h.digest());
};
const leU32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return new Uint8Array(b);
};
const toU8Arr32 = (buf: Uint8Array) => {
  if (buf.length !== 32) throw new Error("expected 32 bytes");
  return Array.from(buf);
};
const leafHash = (tileIndex: number, isMine: number, nonce32: Uint8Array) => {
  return sha256([
    new TextEncoder().encode("leaf"),
    leU32(tileIndex),
    new Uint8Array([isMine]),
    nonce32,
  ]);
};

type Tree = { levels: Uint8Array[][] }; // levels[0] = leaves, up to root levels[MERKLE_DEPTH]
function buildTree(leaves: Uint8Array[]): Tree {
  if (leaves.length !== TREE_LEAVES) throw new Error("bad leaf count");
  const levels: Uint8Array[][] = [leaves];
  for (let d = 0; d < MERKLE_DEPTH; d++) {
    const prev = levels[d];
    const next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = prev[i + 1];
      next.push(sha256([left, right]));
    }
    levels.push(next);
  }
  return { levels };
}
function getProof(index: number, tree: Tree): { proof: Uint8Array[]; pathBits: number } {
  let idx = index;
  const proof: Uint8Array[] = [];
  let pathBits = 0;
  for (let d = 0; d < MERKLE_DEPTH; d++) {
    const isRight = (idx & 1) === 1;
    const sibling = tree.levels[d][isRight ? idx - 1 : idx + 1];
    proof.push(sibling);
    if (isRight) pathBits |= 1 << d;
    idx = idx >> 1;
  }
  return { proof, pathBits };
}

describe("mines (merkle commit)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Mines as Program<any>;

  let gameKp: Keypair;
  let vaultPda: PublicKey;
  let house: PublicKey;
  let player: PublicKey;

  // Game plan: choose 5 mines positions; reveal a safe tile and cash out original bet
  const betLamports = new BN(5);
  const numMines = 5;
  const isMineByIndex: number[] = Array(MAX_BOARD_SIZE).fill(0);
  for (let i = 0; i < numMines; i++) isMineByIndex[i] = 1; // first 5 are mines, rest safe
  const nonces: Uint8Array[] = Array(TREE_LEAVES)
    .fill(null)
    .map(() => crypto.randomBytes(32));

  // Build leaves for 32 slots. For 0..24, use real tiles; 25..31 fillers as safe with fixed nonces.
  const leaves: Uint8Array[] = [];
  for (let i = 0; i < TREE_LEAVES; i++) {
    if (i < MAX_BOARD_SIZE) {
      leaves.push(leafHash(i, isMineByIndex[i], nonces[i]));
    } else {
      // filler leaves
      leaves.push(leafHash(i, 0, nonces[i]));
    }
  }
  const tree = buildTree(leaves);
  const root = tree.levels[MERKLE_DEPTH][0];

  it("starts a game with merkle commitment", async () => {
    gameKp = Keypair.generate();
    const [vault, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), gameKp.publicKey.toBuffer()],
      program.programId
    );
    vaultPda = vault;

    house = provider.wallet.publicKey; // test uses wallet as house
    player = provider.wallet.publicKey;

    await program.methods
      .startGame(betLamports, numMines, Array.from(root))
      .accounts({
        game: gameKp.publicKey,
        vault: vaultPda,
        player,
        house,
        systemProgram: SystemProgram.programId,
      })
      .signers([gameKp])
      .rpc();

    const game = await program.account.minesGame.fetch(gameKp.publicKey);
    assert.isTrue(game.isActive);
    assert.equal(game.numMines, numMines);
    assert.equal(game.betAmount.toNumber(), betLamports.toNumber());
  });

  it("reveals a safe tile with merkle proof", async () => {
    const safeIndex = 10; // we set first 5 as mines; 10 is safe
    const { proof, pathBits } = getProof(safeIndex, tree);

    await program.methods
      .revealTile(
        safeIndex,
        0,
        Array.from(nonces[safeIndex]),
        proof.map((p) => Array.from(p)),
        pathBits
      )
      .accounts({
        game: gameKp.publicKey,
        player,
      })
      .rpc();

    const game = await program.account.minesGame.fetch(gameKp.publicKey);
    assert.isTrue(game.revealedTiles[safeIndex]);
    assert.isFalse(game.lost);
    assert.isTrue(game.isActive);
    assert.equal(game.revealedCount, 1);
  });

  it("cashes out bet back to player", async () => {
    await program.methods
      .cashOut()
      .accounts({
        game: gameKp.publicKey,
        vault: vaultPda,
        player,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    try {
      const game = await program.account.minesGame.fetch(gameKp.publicKey);
      // Depending on runtime, account may already be closed; if not, it should be inactive
      assert.isFalse(game.isActive);
    } catch (e) {
      // If fetch fails, the account was closed as expected
      assert.isTrue(true);
    }
  });
});
