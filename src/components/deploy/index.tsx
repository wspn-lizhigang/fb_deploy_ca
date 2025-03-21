import { useState, useEffect, useRef } from "react";
import {
  Box,
  Button,
  Container,
  FormControl,
  FormLabel,
  Input,
  VStack,
  Heading,
  Text,
  useToast,
  Switch,
  Divider,
  Code,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Progress,
  Card,
  CardBody,
  CardHeader,
  InputGroup,
  InputRightElement,
} from "@chakra-ui/react";
import {
  FeeLevel,
  FireblocksConnectionAdapter,
  FireblocksConnectionAdapterConfig,
} from "@/fireblocks/index";
import {
  clusterApiUrl,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  BPF_LOADER_PROGRAM_ID,
} from "@solana/web3.js";
interface DeploymentStatus {
  status: "idle" | "deploying" | "success" | "error";
  message: string;
  logs: string[];
  programId?: string;
}

const DeployView = () => {
  // Hardcoded configuration values
  const apiKey = import.meta.env.VITE_FIREBLOCKS_API_KEY;
  const apiSecretPath = import.meta.env.VITE_FIREBLOCKS_SECRET_KEY_PATH;
  const vaultAccountId = import.meta.env.VITE_FIREBLOCKS_VAULT_ACCOUNT_ID;
  const feeLevel = FeeLevel.MEDIUM;
  const isDevnet = true;
  // Form state
  const [programPath, setProgramPath] = useState("");
  const [isSilent] = useState(false);

  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [programData, setProgramData] = useState<Buffer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Deployment status
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus>({
    status: "idle",
    message: "",
    logs: [],
  });

  const toast = useToast();

  // Handle file selection
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      setSelectedFile(file);
      // Read file content directly
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target && e.target.result) {
          // Store file content in state instead of writing to filesystem
          setProgramData(Buffer.from(e.target.result as ArrayBuffer));
          setProgramPath(file.name); // Just store the filename for display
          toast({
            title: "File uploaded",
            description: `File ${file.name} has been uploaded successfully`,
            status: "success",
            duration: 3000,
            isClosable: true,
          });
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  // Trigger file input click
  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const addLog = (log: string) => {
    setDeploymentStatus((prev) => ({
      ...prev,
      logs: [...prev.logs, log],
    }));
  };

  const deployProgram = async () => {
    // Validate inputs
    if (!apiKey || !apiSecretPath || !vaultAccountId || !programData) {
      toast({
        title: "Missing required fields",
        description:
          "Please fill in all required fields and upload a program file",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    try {
      // Reset deployment status
      setDeploymentStatus({
        status: "deploying",
        message: "Starting Solana program deployment...",
        logs: ["Starting Solana program deployment..."],
      });

      // Configure Fireblocks connection
      addLog("Configuring Fireblocks connection...");
      const fireblocksConnectionConfig: FireblocksConnectionAdapterConfig = {
        apiKey,
        apiSecretPath,
        vaultAccountId,
        feeLevel,
        silent: isSilent,
        devnet: isDevnet,
      };

      // Create connection to Solana network
      addLog(
        `Creating connection to Solana ${isDevnet ? "devnet" : "mainnet"}...`
      );
      const endpoint = isDevnet
        ? clusterApiUrl("devnet")
        : clusterApiUrl("mainnet-beta");

      // Create connection to Solana using Fireblocks adapter
      const connection = await FireblocksConnectionAdapter.create(
        endpoint,
        fireblocksConnectionConfig
      );

      // Get the account public key from the Fireblocks vault
      const payerPublicKey = new PublicKey(connection.getAccount());
      addLog(`Deployer account: ${payerPublicKey.toBase58()}`);

      // Use the connected wallet's account as the program keypair
      // This assumes the wallet has the necessary permissions to deploy programs
      let programKeypair;

      try {
        // Try to use the connected wallet's account
        programKeypair = new Keypair({
          publicKey: payerPublicKey.toBytes(),
          secretKey: new Uint8Array(64), // This is a placeholder, as we'll use the wallet for signing
        });
        addLog(
          `Using connected wallet as program keypair: ${programKeypair.publicKey.toBase58()}`
        );
      } catch (error) {
        // If there's an error, fall back to generating a new keypair
        addLog(
          `Unable to use connected wallet as program keypair, generating new one...`
        );
        programKeypair = Keypair.generate();
        addLog(
          `Generated new program keypair: ${programKeypair.publicKey.toBase58()}`
        );
      }

      // Check program data
      addLog(`Checking program file: ${programPath}...`);

      if (!programData) {
        throw new Error(
          `Program data not available. Please upload a program file.`
        );
      }

      // Use the program data from state
      addLog(`Program size: ${programData.length} bytes`);

      // Set transaction note
      connection.setTxNote(
        "Deploying Solana program with Fireblocks Connection Adapter"
      );

      // Calculate minimum balance for rent exemption
      const minimumBalanceForRentExemption =
        await connection.getMinimumBalanceForRentExemption(programData.length);
      addLog(
        `Minimum balance for rent exemption: ${minimumBalanceForRentExemption / LAMPORTS_PER_SOL} SOL`
      );

      // Deploy the program
      addLog("Deploying program...");

      // 1. Create program account
      addLog("Creating program account...");
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

      // Sign with program keypair
      createAccountTransaction.partialSign(programKeypair);

      const createAccountTxHash = await sendAndConfirmTransaction(
        connection,
        createAccountTransaction,
        [] // Empty array since Fireblocks will handle the payer signature
      );
      addLog(
        `Program account created: https://explorer.solana.com/tx/${createAccountTxHash}?cluster=${isDevnet ? "devnet" : "mainnet"}`
      );

      // 2. Write program data in chunks
      addLog("Writing program data in chunks...");
      const chunkSize = 900; // Solana has a limit on transaction size
      let offset = 0;

      while (offset < programData.length) {
        const chunk = programData.slice(offset, offset + chunkSize);

        const writeTransaction = new Transaction();
        const dataLayout = Buffer.alloc(4 + 4 + chunk.length);
        dataLayout.writeUInt32LE(0, 0); // Write instruction (0 = Load)
        dataLayout.writeUInt32LE(offset, 4); // Write offset
        chunk.copy(dataLayout, 8); // Copy data chunk

        writeTransaction.add(
          new TransactionInstruction({
            keys: [
              {
                pubkey: programKeypair.publicKey,
                isSigner: true,
                isWritable: true,
              },
            ],
            programId: BPF_LOADER_PROGRAM_ID,
            data: dataLayout,
          })
        );

        const writeTxHash = await sendAndConfirmTransaction(
          connection,
          writeTransaction,
          [] // Empty array since Fireblocks will handle the payer signature
        );

        addLog(
          `Wrote chunk at offset ${offset}: https://explorer.solana.com/tx/${writeTxHash}?cluster=${isDevnet ? "devnet" : "mainnet"}`
        );
        offset += chunkSize;
      }

      // 3. Finalize the program
      addLog("Finalizing program...");
      const finalizeTransaction = new Transaction();
      const finalizeData = Buffer.alloc(4);
      finalizeData.writeUInt32LE(1, 0); // Write instruction (1 = Finalize)

      finalizeTransaction.add(
        new TransactionInstruction({
          keys: [
            {
              pubkey: programKeypair.publicKey,
              isSigner: true,
              isWritable: true,
            },
            {
              pubkey: new PublicKey(
                "SysvarRent111111111111111111111111111111111"
              ),
              isSigner: false,
              isWritable: false,
            },
          ],
          programId: BPF_LOADER_PROGRAM_ID,
          data: finalizeData,
        })
      );

      const finalizeTxHash = await sendAndConfirmTransaction(
        connection,
        finalizeTransaction,
        [] // Empty array since Fireblocks will handle the payer signature
      );

      addLog(
        `Program finalized: https://explorer.solana.com/tx/${finalizeTxHash}?cluster=${isDevnet ? "devnet" : "mainnet"}`
      );

      // Set success status
      setDeploymentStatus({
        status: "success",
        message: "Program deployment completed successfully!",
        logs: [
          ...deploymentStatus.logs,
          "Program deployment completed successfully!",
        ],
        programId: programKeypair.publicKey.toBase58(),
      });

      toast({
        title: "Deployment successful",
        description: `Program deployed with ID: ${programKeypair.publicKey.toBase58()}`,
        status: "success",
        duration: 5000,
        isClosable: true,
      });
    } catch (error) {
      console.error("Error deploying program:", error);
      setDeploymentStatus({
        status: "error",
        message: `Error deploying program: ${error instanceof Error ? error.message : String(error)}`,
        logs: [
          ...deploymentStatus.logs,
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ],
      });

      toast({
        title: "Deployment failed",
        description: error instanceof Error ? error.message : String(error),
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  };

  return (
    <Container maxW="container.lg" py={8}>
      <VStack spacing={6} align="stretch">
        <Heading as="h1" size="xl" textAlign="center">
          Solana Program Deployment
        </Heading>
        <Card>
          <CardHeader>
            <Heading size="md">Program Configuration</Heading>
          </CardHeader>
          <CardBody>
            <VStack spacing={4} align="stretch">
              <FormControl isRequired>
                <FormLabel>Program Path</FormLabel>
                <Input
                  value={programPath}
                  onChange={(e) => setProgramPath(e.target.value)}
                  placeholder="Path to your compiled Solana program (.so file)"
                />
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Program File</FormLabel>
                <InputGroup>
                  <Input
                    value={
                      selectedFile ? selectedFile.name : "No file selected"
                    }
                    readOnly
                    placeholder="Select a program file (.so)"
                  />
                  <InputRightElement width="4.5rem">
                    <Button h="1.75rem" size="sm" onClick={handleUploadClick}>
                      Upload
                    </Button>
                  </InputRightElement>
                </InputGroup>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".so"
                  style={{ display: "none" }}
                />
                <Text fontSize="sm" color="gray.500">
                  Upload your compiled Solana program (.so file)
                </Text>
              </FormControl>

              <Text fontSize="sm" color="gray.500">
                Note: You need to compile your Solana program using the Solana
                CLI before deployment. Example:{" "}
                <Code>
                  cargo build-bpf --manifest-path=./path/to/program/Cargo.toml
                </Code>
              </Text>
            </VStack>
          </CardBody>
        </Card>

        <Button
          colorScheme="blue"
          size="lg"
          onClick={deployProgram}
          isLoading={deploymentStatus.status === "deploying"}
          loadingText="Deploying"
          isDisabled={deploymentStatus.status === "deploying"}
        >
          Deploy Program
        </Button>

        {deploymentStatus.status !== "idle" && (
          <Card>
            <CardHeader>
              <Heading size="md">
                Deployment Status:{" "}
                {deploymentStatus.status.charAt(0).toUpperCase() +
                  deploymentStatus.status.slice(1)}
              </Heading>
            </CardHeader>
            <CardBody>
              {deploymentStatus.status === "deploying" && (
                <Progress size="sm" isIndeterminate colorScheme="blue" mb={4} />
              )}

              {deploymentStatus.status === "success" && (
                <Alert status="success" mb={4}>
                  <AlertIcon />
                  <Box>
                    <AlertTitle>Deployment Successful!</AlertTitle>
                    <AlertDescription>
                      Program ID: {deploymentStatus.programId}
                    </AlertDescription>
                  </Box>
                </Alert>
              )}

              {deploymentStatus.status === "error" && (
                <Alert status="error" mb={4}>
                  <AlertIcon />
                  <Box>
                    <AlertTitle>Deployment Failed</AlertTitle>
                    <AlertDescription>
                      {deploymentStatus.message}
                    </AlertDescription>
                  </Box>
                </Alert>
              )}

              <Divider my={4} />

              <Heading size="sm" mb={2}>
                Deployment Logs
              </Heading>
              <Box
                bg="gray.50"
                p={3}
                borderRadius="md"
                maxH="300px"
                overflowY="auto"
                fontFamily="monospace"
                fontSize="sm"
              >
                {deploymentStatus.logs.map((log, index) => (
                  <Text key={index}>{log}</Text>
                ))}
              </Box>
            </CardBody>
          </Card>
        )}
      </VStack>
    </Container>
  );
};

export default DeployView;
