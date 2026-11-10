import { both } from './demo-language';

// Documentation of formats and paths, never the contents of runtime files.
export const storageLocations = [
  {
    id: 'browser',
    title: both('Browser session', 'Сессия браузера'),
    location: 'sessionStorage + localStorage + HttpOnly cookie',
    format: both('Tab selector + opaque session token', 'Идентификатор вкладки + случайный токен'),
    content: both(
      'sessionStorage keeps the tab context and wagmi connection settings. localStorage can keep a pending checkout ID and transaction hash for recovery. An HttpOnly cookie carries the login token. None of these is a private key or an ETH balance.',
      'В sessionStorage — контекст вкладки и настройки подключения wagmi. В localStorage могут оставаться ID незавершённой покупки и хеш транзакции для восстановления. В HttpOnly-cookie — токен входа. Это не приватный ключ и не баланс ETH.',
    ),
  },
  {
    id: 'database',
    title: both('Accounts and catalog', 'Аккаунты и каталог'),
    location: 'data/artguard.sqlite',
    format: 'SQLite · users, sessions, wallets, artworks',
    content: both(
      'SQL rows store IDs, names, emails, salted scrypt password hashes, session-token hashes, public wallet addresses, project metadata and SHA-256. Some list fields are JSON text; the database itself is a binary SQLite file.',
      'SQL-строки содержат ID, имена, email, scrypt-хеши паролей с солью, хеши токенов сессий, публичные адреса кошельков, данные проектов и SHA-256. Некоторые списки — JSON-текст; сама база — бинарный файл SQLite.',
    ),
  },
  {
    id: 'files',
    title: both('Original project files', 'Оригиналы файлов'),
    location: 'data/uploads/<generated filename>',
    format: both('Original file bytes on disk', 'Исходные байты файлов на диске'),
    content: both(
      'SQLite stores the filename, MIME type, size and hash, not the original bytes. The image route creates a protected preview. The download route checks the account and an unexpired purchase before returning the original to a buyer.',
      'В SQLite — имя файла, MIME-тип, размер и хеш, а не байты оригинала. Маршрут изображения создаёт защищённое превью. Перед выдачей оригинала покупателю маршрут скачивания проверяет аккаунт и действующую покупку.',
    ),
  },
  {
    id: 'orders',
    title: both('Offers, orders and accounting', 'Предложения, сделки и учёт'),
    location: 'data/artguard.sqlite',
    format:
      'chain_checkouts · chain_checkout_items · escrow_records · purchases · accounting_events',
    content: both(
      'The server keeps quote fields, signatures, terms snapshots, transaction hashes, order copies and license validity. Wei amounts use decimal text to avoid floating-point loss. These rows support the UI and accounting; they do not create an on-chain payment.',
      'Сервер хранит поля предложений, подписи, снимки условий, хеши транзакций, копии заказов и сроки лицензий. Суммы wei записаны десятичным текстом без потери точности. Эти строки нужны интерфейсу и учёту; сами по себе они не создают оплату в блокчейне.',
    ),
  },
  {
    id: 'chain',
    title: both('Contract data and test ETH', 'Данные контрактов и test ETH'),
    location: 'Anvil · chain 31337 → data/chain/state.json',
    format: both(
      'EVM code, account balances and contract storage; persisted node state',
      'Код EVM, балансы адресов и storage контрактов; сохранённое состояние узла',
    ),
    content: both(
      'The registry maps fileHash to a wallet, terms hash and time. Escrow stores orders, deadlines, used quotes, licenses, revenue and refund credits. Deposited ETH belongs to the contract account until withdrawn. RPC reads transaction receipts and events from this node. It is one operator-controlled local chain.',
      'Реестр связывает fileHash с кошельком, хешем условий и временем. Escrow хранит заказы, сроки, использованные предложения, лицензии и начисления. Внесённый ETH находится на адресе контракта до вывода. RPC читает квитанции и события этого узла. Это одна локальная сеть под контролем оператора.',
    ),
  },
  {
    id: 'deployment',
    title: both('Contract addresses', 'Адреса контрактов'),
    location: 'data/chain/registry.json · escrow-marketplace.json',
    format: both('JSON deployment metadata', 'JSON с данными развёртывания'),
    content: both(
      'The app uses saved addresses and instance identifiers to find its contracts and check the running network. These configuration files are not the smart contract storage or proof of payment.',
      'Приложение использует сохранённые адреса и идентификаторы экземпляров, чтобы найти контракты и проверить сеть. Эти файлы настройки не являются storage контракта или доказательством оплаты.',
    ),
  },
  {
    id: 'keys',
    title: both('Signing keys', 'Ключи подписи'),
    location: both(
      'External wallet OR Anvil test-node accounts',
      'Внешний кошелёк ИЛИ тестовые аккаунты Anvil',
    ),
    format: both(
      'Wallet extension; private node configuration in hosted mode',
      'Расширение кошелька; приватная конфигурация узла в публичном режиме',
    ),
    content: both(
      'An external wallet keeps its key in the wallet. For demo wallets, the server requests signing from an unlocked Anvil account after checking permissions. Local Anvil uses test keys; the hosted test node saves its random mnemonic in chain/accounts.private.json under its isolated data directory. No keys are displayed or included in the public source archive.',
      'Ключ внешнего кошелька остаётся в кошельке. Для демо-кошелька сервер после проверки прав просит разблокированный аккаунт Anvil подписать запрос. Локальный Anvil использует тестовые ключи; публичный тестовый узел сохраняет случайную мнемонику в chain/accounts.private.json внутри отдельной папки данных. Ключи здесь не показываются и в публичный архив исходников не входят.',
    ),
  },
  {
    id: 'document',
    title: both('Downloadable license record', 'Скачиваемая запись о лицензии'),
    location: 'GET /api/licenses/:id/document',
    format: both('TXT generated on request', 'TXT, создаваемый при запросе'),
    content: both(
      'Express generates the text from purchase records, the terms snapshot, wallet, file hash, period and transaction references. It is not an NFT or an official certification. The on-chain wallet entitlement is a separate contract record.',
      'Express создаёт текст из записи покупки, снимка условий, кошелька, хеша файла, срока и ссылок на транзакции. Это не NFT и не официальный сертификат. Право кошелька в блокчейне — отдельная запись контракта.',
    ),
  },
];

export const walletTrace = [
  both('Connect provider', 'Подключить кошелёк'),
  both('Request SIWE nonce', 'Получить SIWE-запрос'),
  both('Sign message', 'Подписать сообщение'),
  both('Verify signature', 'Проверить подпись'),
  both('Save public address', 'Сохранить адрес'),
];
export const demoWalletTrace = [
  both('Signed-in account', 'Аккаунт с сессией'),
  both('Assigned test address', 'Его тестовый адрес'),
  both('Permission checks', 'Проверка прав'),
  both('Anvil signs / sends', 'Anvil подписывает'),
  both('Real local tx hash', 'Хеш локальной транзакции'),
];
export const escrowTrace = [
  {
    id: 'deposit',
    title: both('1. Deposit', '1. Депозит'),
    detail: both('Buyer → contract · held ETH', 'Покупатель → контракт · ETH удерживается'),
  },
  {
    id: 'delivery',
    title: both('2. Delivery / dispute', '2. Передача / спор'),
    detail: both('Seller 72h → buyer 24h', 'Автор: 72 ч → покупатель: 24 ч'),
  },
  {
    id: 'release',
    title: both('3. Release', '3. Завершение'),
    detail: both('Activate license + credit shares', 'Активировать лицензию + начислить доли'),
  },
  {
    id: 'withdraw',
    title: both('4. Withdraw', '4. Вывод'),
    detail: both('Contract credit → recipient wallet', 'Начисление → кошелёк получателя'),
  },
  {
    id: 'refund',
    title: both('Alternative: refund', 'Альтернатива: возврат'),
    detail: both('Refund credit → buyer withdraws', 'Начислить возврат → покупатель выводит'),
  },
];
