import {
  BpfLoader,
  BPF_LOADER_PROGRAM_ID,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  clusterApiUrl,
  SystemProgram,
  TransactionInstruction
} from "@solana/web3.js";
import {
  FireblocksConnectionAdapter,
  FireblocksConnectionAdapterConfig,
  FeeLevel,
} from "../src/index";
import fs from "fs";

require("dotenv").config();

async function deployProgram() {
  console.log("Starting Solana program deployment...");

  // Configure Fireblocks connection
  const fireblocksConnectionConfig: FireblocksConnectionAdapterConfig = {
    apiKey: process.env.FIREBLOCKS_API_KEY || "",
    apiSecretPath: process.env.FIREBLOCKS_SECRET_KEY_PATH || "",
    vaultAccountId: process.env.FIREBLOCKS_VAULT_ACCOUNT_ID || "",
    feeLevel: FeeLevel.HIGH, // Use high fee level for deployment transactions
    silent: false,
    devnet: true, // Set to true for devnet, false for mainnet
  };

  // Create connection to Solana devnet
  const connection = await FireblocksConnectionAdapter.create(
    clusterApiUrl("devnet"),
    fireblocksConnectionConfig
  );

  // Get the account public key from the Fireblocks vault
  const payerPublicKey = new PublicKey(connection.getAccount());
  console.log("Deployer account:", payerPublicKey.toBase58());

  // Create a new keypair for the program
  const programKeypair = Keypair.generate();
  console.log("Program ID:", programKeypair.publicKey.toBase58());

  // Path to the compiled program (replace with your actual program path)
  // Note: You need to compile your Solana program using the Solana CLI before running this script
  // Example: solana-test-validator
  // In another terminal: cargo build-bpf --manifest-path=./path/to/program/Cargo.toml
  const programPath = "@/deployfile/wusd_token.so";

  // For this example, we'll check if the file exists
  if (!fs.existsSync(programPath)) {
    console.error(`Program file not found at ${programPath}`);
    console.error(
      "Please compile your Solana program before running this script"
    );
    console.error(
      "Example: cargo build-bpf --manifest-path=./path/to/program/Cargo.toml"
    );
    return;
  }

  // Read the program file
  const programData = fs.readFileSync(programPath);
  console.log(`Program size: ${programData.length} bytes`);

  // Set transaction note
  connection.setTxNote(
    "Deploying Solana program with Fireblocks Connection Adapter"
  );

  try {
    // Calculate minimum balance for rent exemption
    const minimumBalanceForRentExemption =
      await connection.getMinimumBalanceForRentExemption(programData.length);
    console.log(
      `Minimum balance for rent exemption: ${minimumBalanceForRentExemption / LAMPORTS_PER_SOL} SOL`
    );

    // Deploy the program
    console.log("Deploying program...");

    // Note: BpfLoader.load requires a signer that we can't provide with Fireblocks
    // Instead, we'll use a multi-step approach with individual transactions

    // 1. Create program account
    const createAccountTransaction = new Transaction();
    createAccountTransaction.add(
      SystemProgram.createAccount({
        fromPubkey: payerPublicKey,
        newAccountPubkey: programKeypair.publicKey,
        lamports: minimumBalanceForRentExemption,
        space: programData.length,
        programId: BPF_LOADER_PROGRAM_ID,
      })
    );

    // Sign and send the create account transaction
    // Note: We need to sign with both the payer and the program keypair
    // Since Fireblocks can only sign with the payer, we'll use partialSign for the program keypair
    createAccountTransaction.partialSign(programKeypair);

    const createAccountTxHash = await sendAndConfirmTransaction(
      connection,
      createAccountTransaction,
      [] // Empty array since Fireblocks will handle the payer signature
    );
    console.log(
      `Program account created: https://explorer.solana.com/tx/${createAccountTxHash}?cluster=devnet`
    );

    // 2. Write program data in chunks
    // BPF programs can be large, so we need to write them in chunks
    const chunkSize = 900; // Solana has a limit on transaction size
    let offset = 0;

    while (offset < programData.length) {
      const chunk = programData.slice(offset, offset + chunkSize);

      const writeTransaction = new Transaction();
      // BpfLoader.write 方法不存在，需要创建自定义指令
      const dataLayout = Buffer.alloc(4 + 4 + chunk.length);
      dataLayout.writeUInt32LE(0, 0); // 写入指令 (0 = Load)
      dataLayout.writeUInt32LE(offset, 4); // 写入偏移量
      chunk.copy(dataLayout, 8); // 复制数据块
      
      writeTransaction.add(new TransactionInstruction({
        keys: [
          {pubkey: programKeypair.publicKey, isSigner: true, isWritable: true}
        ],
        programId: BPF_LOADER_PROGRAM_ID,
        data: dataLayout
      }));

      const writeTxHash = await sendAndConfirmTransaction(
        connection,
        writeTransaction,
        [] // Empty array since Fireblocks will handle the payer signature
      );

      console.log(
        `Wrote chunk at offset ${offset}: https://explorer.solana.com/tx/${writeTxHash}?cluster=devnet`
      );
      offset += chunkSize;
    }

    // 3. Finalize the program
    const finalizeTransaction = new Transaction();
    // BpfLoader.finalize 方法不存在，需要创建自定义指令
    const finalizeData = Buffer.alloc(4);
    finalizeData.writeUInt32LE(1, 0); // 写入指令 (1 = Finalize)
    
    finalizeTransaction.add(new TransactionInstruction({
      keys: [
        {pubkey: programKeypair.publicKey, isSigner: true, isWritable: true},
        {pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false}
      ],
      programId: BPF_LOADER_PROGRAM_ID,
      data: finalizeData
    }));

    const finalizeTxHash = await sendAndConfirmTransaction(
      connection,
      finalizeTransaction,
      [] // Empty array since Fireblocks will handle the payer signature
    );

    console.log(
      `Program finalized: https://explorer.solana.com/tx/${finalizeTxHash}?cluster=devnet`
    );
    console.log("Program deployment completed successfully!");
    console.log(`Program ID: ${programKeypair.publicKey.toBase58()}`);
    console.log(
      `Verify your program at: https://explorer.solana.com/address/${programKeypair.publicKey.toBase58()}?cluster=devnet`
    );
  } catch (error) {
    console.error("Error deploying program:", error);
  }
}

deployProgram();
