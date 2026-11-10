import { technicalSteps, type SourceExcerpt } from './technical-source';
import { both } from './demo-language';

function source(id: string, index = 0, count?: number): SourceExcerpt {
  const value = technicalSteps.find((item) => item.id === id)!.sources[index];
  return count ? { ...value, code: value.code.split('\n').slice(0, count).join('\n') } : value;
}
function line(id: string, index: number, anchor: string, count = 1): SourceExcerpt {
  const value = source(id, index);
  const lines = value.code.split('\n');
  const start = lines.findIndex((item) => item.includes(anchor));
  if (start < 0) throw new Error(`Visible walkthrough anchor missing: ${anchor}`);
  return {
    ...value,
    firstLine: value.firstLine + start,
    code: lines.slice(start, start + count).join('\n'),
  };
}

// Expected formats with placeholders, never fabricated live receipts or server logs.
export const linearSteps = [
  {
    id: 'chain',
    title: both('Start the blockchain', 'Запуск блокчейна'),
    text: both(
      'Anvil starts the local network; a fresh network deploys the contracts. Saved deployments are reused.',
      'Anvil запускает локальную сеть. В новой сети контракты разворачиваются, сохранённые — используются повторно.',
    ),
    command: '# Terminal 1\nnpm run chain',
    sources: [source('chain', 1)],
    outputKind: both('Terminal example', 'Пример терминала'),
    output:
      'ArtGuard local chain ready: http://127.0.0.1:8545 (chain 31337)\nRegistry: <registry address>. State saved under data/chain. Test ETH only.\nEscrow marketplace: <escrow address>',
  },
  {
    id: 'client',
    title: both('Start React and the API', 'Запуск React и сервера'),
    text: both(
      'Terminal 2 starts Express on 3000 and React/Vite on 5173. Open localhost:5173.',
      'Во втором терминале запускаются Express на 3000 и React/Vite на 5173. Открой localhost:5173.',
    ),
    command: '# Terminal 2\nnpm run demo:setup\nnpm run dev',
    sources: [source('client', 1)],
    outputKind: both('Terminal example', 'Пример терминала'),
    output:
      '[api] ArtGuard API + built React app: http://localhost:3000\n[web] VITE v<version> ready in <ms> ms\n[web] Local: http://localhost:5173/',
  },
  {
    id: 'wallet',
    title: both('Link the wallet', 'Привязка кошелька'),
    text: both(
      'The wallet signs a one-time linking message, without authorizing a payment. Prepared demo accounts sign through the API and Anvil.',
      'Кошелёк подписывает одноразовое сообщение привязки, без разрешения на оплату. Тестовые аккаунты подписывают через API и Anvil.',
    ),
    command: null,
    sources: [source('wallet', 1, 15), source('demo-wallet', 3)],
    outputKind: both('HTTP / wallet example', 'Пример HTTP / кошелька'),
    output:
      'POST /api/wallet/challenge → { nonce, message }\npersonal_sign(message) → <signature>\nPOST /api/wallet/link → 200\nSQLite: wallets(user_id, address, linked_at)\nDemo signing: /api/demo/wallet/rpc → Anvil',
  },
  {
    id: 'file',
    title: both('Save the file and its fingerprint', 'Файл и его отпечаток'),
    text: both(
      'SHA-256 is calculated from the original bytes. The file stays on disk; the creator registers its hash on-chain.',
      'SHA-256 вычисляется из байтов оригинала. Файл остаётся на диске; автор регистрирует его хеш в блокчейне.',
    ),
    command: null,
    sources: [source('fingerprint', 0, 4), source('register', 1)],
    outputKind: both('HTTP / RPC example', 'Пример HTTP / RPC'),
    output:
      'POST /api/artworks → 201\nOriginal → data/uploads/<filename>\nSHA-256 → <fileHash>\nArtworkRegistered(fileHash, registrant, termsHash, registeredAt)',
  },
  {
    id: 'deposit',
    title: both('Deposit the payment into escrow', 'Оплата в escrow'),
    text: both(
      'The buyer sends the signed offer and exact test ETH amount. The contract holds the deposit; the license is not active yet.',
      'Покупатель отправляет подписанное предложение и точную сумму test ETH. Контракт удерживает депозит; лицензия ещё не действует.',
    ),
    command: null,
    sources: [source('deposit', 0), line('deposit', 1, 'if (msg.value != total)')],
    outputKind: both('RPC result example', 'Пример результата RPC'),
    output:
      'transactionHash → <deposit hash>\nreceipt.status → success\nEscrowFunded → <order ID>\ngetEscrow(orderId).state → 1 (funded)',
  },
  {
    id: 'release',
    title: both('Accept delivery and activate the license', 'Передача и активация лицензии'),
    text: both(
      'Delivery: 72h; buyer review: 24h. Acceptance activates the license and credits the shares. A dispute goes to the trusted arbiter; after 7 unresolved days a refund becomes available.',
      'Передача — 72 ч, проверка покупателем — 24 ч. Принятие активирует лицензию и начисляет доли. Спор решает доверенный арбитр; через 7 дней без решения доступен возврат.',
    ),
    command: null,
    sources: [
      source('release', 0),
      line('release', 1, 'uint64 expiry', 3),
      line('release', 1, 'balances[recipient] += share', 2),
    ],
    outputKind: both('RPC result example', 'Пример результата RPC'),
    output:
      'markDelivered(orderId) → state 2 (delivered)\nrelease(orderId) → state 4 (released)\nLicenseValidity → start / expiry\nRevenueAllocated → creator / co-authors\nAlternative: dispute → resolveDispute → release or refund',
  },
  {
    id: 'withdraw',
    title: both('Withdraw each author’s share', 'Вывод долей авторам'),
    text: both(
      'Credits remain in the contract until each recipient calls withdraw from their own wallet. Refunds use withdrawRefund.',
      'Начисления остаются в контракте, пока каждый получатель не вызовет withdraw своим кошельком. Для возврата покупателю — withdrawRefund.',
    ),
    command: null,
    sources: [source('withdraw')],
    outputKind: both('RPC result example', 'Пример результата RPC'),
    output:
      'withdraw() → <withdrawal hash>\nreceipt.status → success\nbalances[wallet] → 0\nProceedsWithdrawn(recipient, amount)\nETH → recipient wallet (gas is separate)',
  },
  {
    id: 'verify',
    title: both('Verify the transaction on the node', 'Проверка транзакции на узле'),
    text: both(
      'RPC supplies the transaction, receipt, block and contract state. Live results from the running node appear below.',
      'RPC возвращает транзакцию, квитанцию, блок и состояние контракта. Ниже — настоящие данные работающего узла.',
    ),
    command: null,
    sources: [source('verify', 0, 15)],
    outputKind: both('RPC result example', 'Пример результата RPC'),
    output:
      'eth_getTransactionReceipt(<deposit hash>)\nstatus → 0x1 (success)\nblockNumber → <block>\ngetEscrow(orderId) → <current state>\nhasLicense(buyer, fileHash, type) → true / false',
  },
];

export const studioBlocks = [
  {
    id: 'startup',
    label: both('Start', 'Запуск'),
    title: both('Start the local stack', 'Запуск локального стека'),
    text: both(
      'Anvil first, then React and Express. Commands and expected output are in the terminal.',
      'Сначала Anvil, затем React и Express. Команды и ожидаемый вывод — в терминале.',
    ),
    steps: ['chain', 'client'],
  },
  {
    id: 'identity',
    label: both('Wallet & file', 'Кошелёк и файл'),
    title: both('Wallet → file → fingerprint', 'Кошелёк → файл → отпечаток'),
    text: both(
      'A signature links the wallet. The original stays on disk; its SHA-256 is registered in the contract.',
      'Подпись привязывает кошелёк. Оригинал остаётся на диске, его SHA-256 регистрируется в контракте.',
    ),
    steps: ['wallet', 'file'],
  },
  {
    id: 'purchase',
    label: both('Escrow & license', 'Escrow и лицензия'),
    title: both('Deposit → review → license', 'Депозит → проверка → лицензия'),
    text: both(
      'Escrow holds the payment. Acceptance activates the license and allocates revenue.',
      'Escrow удерживает оплату. Принятие активирует лицензию и начисляет доли.',
    ),
    steps: ['deposit', 'release'],
  },
  {
    id: 'evidence',
    label: both('Payouts & proof', 'Выплаты и проверка'),
    title: both('Withdraw → verify on the node', 'Вывод → проверка на узле'),
    text: both(
      'Each author withdraws their own credit. The live section reads a real receipt from Anvil.',
      'Каждый автор выводит своё начисление. Секция LIVE читает настоящую квитанцию из Anvil.',
    ),
    steps: ['withdraw', 'verify'],
  },
];

export const linearStorage = [
  {
    title: both('Accounts and orders', 'Аккаунты и сделки'),
    path: 'data/artguard.sqlite',
    note: 'users · wallets · artworks · purchases · escrow_records',
  },
  {
    title: both('Original files', 'Оригиналы файлов'),
    path: 'data/uploads/',
    note: both(
      'License TXT is generated by GET /api/licenses/:id/document.',
      'TXT лицензии создаётся при GET /api/licenses/:id/document.',
    ),
  },
  {
    title: both('Blockchain state', 'Состояние блокчейна'),
    path: 'Anvil → data/chain/state.json',
    note: both(
      'Contract storage, account balances and node state.',
      'Storage контрактов, балансы адресов и состояние узла.',
    ),
  },
  {
    title: both('Signing keys', 'Ключи подписи'),
    path: both(
      'External wallet / unlocked Anvil test accounts',
      'Внешний кошелёк / тестовые аккаунты Anvil',
    ),
    note: both(
      'Hosted test-node mnemonic: chain/accounts.private.json in its isolated data directory. Keys are never displayed here.',
      'Мнемоника публичного тестового узла — chain/accounts.private.json в отдельной папке данных. Значения ключей здесь не показываются.',
    ),
  },
];
