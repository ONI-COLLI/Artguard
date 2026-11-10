import { both } from './demo-language';

export const walkthroughStages = [
  {
    id: 'startup',
    label: both('Start', 'Запуск'),
    title: both('Start the app and blockchain', 'Запусти сайт и блокчейн'),
    text: both(
      'Use two terminals: one for Anvil, one for the client and API.',
      'Нужны два терминала: один для Anvil, второй — для клиента и сервера.',
    ),
    result: both(
      'Open localhost:5173 after both are ready.',
      'Когда оба запущены, открой localhost:5173.',
    ),
    sources: ['install', 'chain', 'client'],
  },
  {
    id: 'wallet',
    label: both('Wallet', 'Кошелёк'),
    title: both('Connect and link a wallet', 'Подключи и привяжи кошелёк'),
    text: both(
      'Connect a wallet and sign a message. The server checks the signature and links the address to your account.',
      'Подключи кошелёк и подпиши сообщение. Сервер проверит подпись и свяжет адрес с твоим аккаунтом.',
    ),
    result: both(
      'Linking a wallet does not authorize a payment.',
      'Подпись привязки не разрешает списание денег.',
    ),
    sources: ['wallet', 'demo-wallet'],
  },
  {
    id: 'file',
    label: both('File', 'Файл'),
    title: both('Upload and register the file', 'Загрузи и зарегистрируй файл'),
    text: both(
      'The server saves the original and calculates SHA-256. The creator registers that fingerprint using their wallet.',
      'Сервер сохраняет оригинал и вычисляет SHA-256. Автор регистрирует этот отпечаток своим кошельком.',
    ),
    result: both(
      'Original: server disk. Fingerprint and registering address: blockchain.',
      'Оригинал — на сервере. Отпечаток и адрес регистрации — в блокчейне.',
    ),
    sources: ['fingerprint', 'register', 'storage'],
  },
  {
    id: 'escrow',
    label: both('Escrow', 'Escrow'),
    title: both('Pay into escrow', 'Оплати через escrow'),
    text: both(
      'The buyer pays the contract. The seller confirms delivery; the buyer accepts or opens a dispute.',
      'Покупатель переводит оплату в контракт. Автор подтверждает передачу; покупатель принимает её или открывает спор.',
    ),
    result: both(
      'The contract holds the money until release or refund.',
      'До завершения или возврата деньги удерживает контракт.',
    ),
    sources: ['quote', 'deposit', 'delivery', 'refund'],
  },
  {
    id: 'license',
    label: both('License', 'Лицензия'),
    title: both('Activate the license and pay the authors', 'Активируй лицензию и выплати доли'),
    text: both(
      'Acceptance activates the buyer’s wallet license and credits revenue shares. Each author then withdraws their own earnings.',
      'Принятие активирует лицензию кошелька покупателя и начисляет доли. Каждый автор затем выводит своё начисление.',
    ),
    result: both(
      'Allocation and withdrawal are separate transactions.',
      'Начисление и вывод — разные транзакции.',
    ),
    sources: ['release', 'withdraw'],
  },
  {
    id: 'verify',
    label: both('Verify', 'Проверка'),
    title: both('Verify the payment on the node', 'Проверь оплату на узле'),
    text: both(
      'Enter the deposit transaction hash below, or leave it empty for the latest payment.',
      'Укажи хеш транзакции депозита ниже или оставь поле пустым для последней оплаты.',
    ),
    result: both(
      'The result comes from Anvil RPC, not a purchase row in SQLite.',
      'Результат приходит из Anvil RPC, а не из строки покупки в SQLite.',
    ),
    sources: ['verify'],
  },
];
