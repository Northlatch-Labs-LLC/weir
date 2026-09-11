// Built-by: @projectx.sui

import { bcs } from '@mysten/sui/bcs';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { Inputs, Transaction } from '@mysten/sui/transactions';
import { publicKeyFromSuiBytes } from '@mysten/sui/verify';
import { fromBase64 } from '@mysten/sui/utils';
import { allow, refuse, type Outcome } from './outcome.js';
import type { MultisigDoc } from './multisig-file.js';

export const BRAKE_MEMBER = 'brake';

export interface ValidDuring {
  readonly ValidDuring: {
    readonly minEpoch: string;
    readonly maxEpoch: string;
    readonly minTimestamp: null;
    readonly maxTimestamp: null;
    readonly chain: string;
    readonly nonce: number;
  };
}

export interface SweepShape {
  readonly sender: string;
  readonly recipient: string;
  readonly amountMist: bigint;
}

export interface SweepBuild extends SweepShape {
  readonly gasBudget: bigint;
  readonly gasPrice: bigint;
  readonly expiration: ValidDuring;
}

const ADDRESS = /^0x[0-9a-f]{64}$/;
const SUI_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const SUI_PACKAGE = '0x0000000000000000000000000000000000000000000000000000000000000002';

export function multisigPublicKeyOf(doc: MultisigDoc): MultiSigPublicKey {
  return MultiSigPublicKey.fromPublicKeys({
    threshold: doc.threshold,
    publicKeys: doc.members.map((member) => ({ publicKey: publicKeyFromSuiBytes(member.publicKey), weight: member.weight })),
  });
}

export async function buildSweep(build: SweepBuild): Promise<Outcome<Uint8Array>> {
  if (!ADDRESS.test(build.sender)) return refuse('request-malformed', `the sender ${build.sender} is not a lower-case full Sui address.`);
  if (!ADDRESS.test(build.recipient)) return refuse('request-malformed', `the recipient ${build.recipient} is not a lower-case full Sui address.`);
  if (build.recipient === build.sender) return refuse('request-malformed', 'the recipient is the sender; a sweep to itself moves nothing and pays gas.');
  if (build.amountMist <= 0n) return refuse('request-malformed', `the amount ${String(build.amountMist)} MIST is not positive.`);
  if (build.gasBudget <= 0n || build.gasPrice <= 0n) return refuse('request-malformed', 'gas budget and gas price must be positive.');

  const tx = new Transaction();
  tx.setSender(build.sender);
  tx.setGasPayment([]);
  tx.setGasBudget(build.gasBudget);
  tx.setGasPrice(build.gasPrice);
  tx.setExpiration(build.expiration);
  const withdrawal = tx.object(
    Inputs.FundsWithdrawal({
      reservation: { $kind: 'MaxAmountU64', MaxAmountU64: String(build.amountMist) },
      typeArg: { $kind: 'Balance', Balance: SUI_TYPE },
      withdrawFrom: { $kind: 'Sender', Sender: true },
    }),
  );
  const coin = tx.moveCall({ target: `${SUI_PACKAGE}::coin::redeem_funds`, typeArguments: [SUI_TYPE], arguments: [withdrawal] });
  tx.transferObjects([coin], tx.pure.address(build.recipient));
  try {
    return allow(await tx.build());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse('request-malformed', `the sweep could not be serialised: ${detail}`);
  }
}

export function inspectSweep(bytes: Uint8Array, expected: SweepShape): Outcome<{ readonly expiration: ValidDuring; readonly gasBudget: bigint }> {
  let data: ReturnType<Transaction['getData']>;
  try {
    data = Transaction.from(bytes).getData();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse('request-malformed', `the bytes are not a transaction: ${detail}`);
  }
  if (data.sender !== expected.sender) {
    return refuse('request-malformed', `the bytes are sent by ${data.sender ?? '(none)'}, not by Heron's address ${expected.sender}. Refused unsigned.`);
  }
  if (data.gasData.payment === null || data.gasData.payment === undefined || data.gasData.payment.length !== 0) {
    return refuse('request-malformed', 'the bytes name gas coins; a sweep from the address balance names none. Refused unsigned.');
  }
  if (data.expiration?.$kind !== 'ValidDuring') {
    return refuse('request-malformed', 'the bytes carry no ValidDuring expiration; a balance-paid transaction must. Refused unsigned.');
  }
  if (data.commands.length !== 2) {
    return refuse('request-malformed', `the bytes carry ${String(data.commands.length)} commands; a sweep is exactly two. Refused unsigned.`);
  }
  const [redeem, transfer] = data.commands;
  if (
    redeem?.$kind !== 'MoveCall' ||
    redeem.MoveCall.package !== SUI_PACKAGE ||
    redeem.MoveCall.module !== 'coin' ||
    redeem.MoveCall.function !== 'redeem_funds' ||
    redeem.MoveCall.typeArguments.length !== 1 ||
    redeem.MoveCall.typeArguments[0] !== SUI_TYPE ||
    redeem.MoveCall.arguments.length !== 1
  ) {
    return refuse('request-malformed', 'the first command is not 0x2::coin::redeem_funds<SUI> over one withdrawal. Refused unsigned.');
  }
  if (transfer?.$kind !== 'TransferObjects' || transfer.TransferObjects.objects.length !== 1) {
    return refuse('request-malformed', 'the second command is not one TransferObjects. Refused unsigned.');
  }
  const object = transfer.TransferObjects.objects[0];
  if (object?.$kind !== 'Result' || object.Result !== 0) {
    return refuse('request-malformed', 'the transferred object is not the coin the withdrawal redeemed. Refused unsigned.');
  }
  const withdrawalArg = redeem.MoveCall.arguments[0];
  const withdrawalInput = withdrawalArg?.$kind === 'Input' ? data.inputs[withdrawalArg.Input] : undefined;
  if (withdrawalInput?.$kind !== 'FundsWithdrawal') {
    return refuse('request-malformed', 'the redeemed argument is not a withdrawal from the sender. Refused unsigned.');
  }
  const withdrawal = withdrawalInput.FundsWithdrawal;
  if (
    withdrawal.reservation.$kind !== 'MaxAmountU64' ||
    withdrawal.typeArg.$kind !== 'Balance' ||
    withdrawal.typeArg.Balance !== SUI_TYPE ||
    withdrawal.withdrawFrom.$kind !== 'Sender'
  ) {
    return refuse('request-malformed', 'the withdrawal is not a bounded SUI withdrawal from the sender. Refused unsigned.');
  }
  const amount = BigInt(withdrawal.reservation.MaxAmountU64);
  const recipientInput = transfer.TransferObjects.address;
  const recipientBytes =
    recipientInput?.$kind === 'Input' && data.inputs[recipientInput.Input]?.$kind === 'Pure'
      ? fromBase64((data.inputs[recipientInput.Input] as { Pure: { bytes: string } }).Pure.bytes)
      : null;
  if (recipientBytes === null) {
    return refuse('request-malformed', 'the recipient is not a pure input. Refused unsigned.');
  }
  const recipient = bcs.Address.parse(recipientBytes);
  if (amount !== expected.amountMist) {
    return refuse('request-malformed', `the bytes move ${String(amount)} MIST, not the ${String(expected.amountMist)} named. Refused unsigned.`);
  }
  if (recipient !== expected.recipient) {
    return refuse('request-malformed', `the bytes send to ${recipient}, not to ${expected.recipient}. Refused unsigned.`);
  }
  return allow({ expiration: data.expiration as ValidDuring, gasBudget: BigInt(data.gasData.budget ?? '0') });
}

export function brakeKeypairFrom(secret: string, doc: MultisigDoc): Outcome<Ed25519Keypair> {
  const trimmed = secret.trim();
  if (trimmed === '') return refuse('request-malformed', 'no key was entered.');
  let keypair: Ed25519Keypair;
  try {
    const decoded = decodeSuiPrivateKey(trimmed);
    if (decoded.scheme !== 'ED25519') return refuse('request-malformed', `the key entered is ${decoded.scheme}; the brake is an ed25519 key.`);
    keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
  } catch {
    return refuse('request-malformed', 'what was entered is not a Sui private key (a bech32 string starting with the Sui secret prefix). Its text is deliberately not shown.');
  }
  const brake = doc.members.find((member) => member.name === BRAKE_MEMBER);
  if (brake === undefined) return refuse('request-malformed', `the multisig document has no member named "${BRAKE_MEMBER}".`);
  const brakeAddress = publicKeyFromSuiBytes(brake.publicKey).toSuiAddress();
  if (keypair.getPublicKey().toSuiAddress() !== brakeAddress) {
    return refuse(
      'request-malformed',
      `the key entered is not the brake. Its address is ${keypair.getPublicKey().toSuiAddress()}; the brake member is ${brakeAddress}. Nothing was signed.`,
    );
  }
  return allow(keypair);
}

export async function signAsMultisig(bytes: Uint8Array, member: Ed25519Keypair, doc: MultisigDoc): Promise<Outcome<string>> {
  const multisig = multisigPublicKeyOf(doc);
  const { signature } = await member.signTransaction(bytes);
  let combined: string;
  try {
    combined = multisig.combinePartialSignatures([signature]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse('request-malformed', `the partial signature could not be combined: ${detail}`);
  }
  const accepted = await multisig.verifyTransaction(bytes, combined);
  if (!accepted) {
    return refuse(
      'request-malformed',
      `the multisig public key does not accept a signature from this member alone: the document's threshold is ${String(doc.threshold)} and this member weighs less. Nothing was sent.`,
    );
  }
  return allow(combined);
}
