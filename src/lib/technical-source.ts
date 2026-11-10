import packageSource from '../../package.json?raw';
import clientSource from '../main.tsx?raw';
import viteSource from '../../vite.config.ts?raw';
import apiSource from '../../server/index.ts?raw';
import chainSource from '../../scripts/local-chain.mjs?raw';
import deploySource from '../../scripts/deploy-escrow-marketplace.mjs?raw';
import uploadSource from '../../server/artwork.routes.ts?raw';
import registrationSource from '../components/chain-registration.tsx?raw';
import registrySource from '../../contracts/ArtworkRegistry.sol?raw';
import quoteSource from '../../server/chain-purchase.routes.ts?raw';
import signerSource from '../../server/blockchain.ts?raw';
import escrowSource from '../../contracts/EscrowLicenseMarketplace.sol?raw';
import proofSource from '../../server/escrow-proof.ts?raw';
import walletSource from '../components/wallet.tsx?raw';
import walletRoutesSource from '../../server/blockchain.routes.ts?raw';
import demoWalletSource from '../lib/demo-wallet.ts?raw';
import demoRoutesSource from '../../server/demo.routes.ts?raw';
import appSource from '../../server/app.ts?raw';
import databaseSource from '../../server/database.ts?raw';
import schemaSource from '../../server/migrations.ts?raw';
import authSource from '../../server/auth.ts?raw';
import documentSource from '../../server/purchase.routes.ts?raw';
import walletConfigSource from '../lib/blockchain.ts?raw';
import checkoutSource from '../components/blockchain-checkout.tsx?raw';

import { both, type Translation } from './demo-language';
export { both, translated, type CodeLanguage, type Translation } from './demo-language';
export interface SourceExcerpt {
  path: string;
  firstLine: number;
  code: string;
  highlight?: string;
}
function excerpt(
  path: string,
  source: string,
  start: string,
  length: number,
  highlight?: string,
): SourceExcerpt {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const first = lines.findIndex((line) => line.includes(start));
  if (first < 0)
    throw new Error(`Technical walkthrough source anchor is missing: ${path}: ${start}`);
  return {
    path,
    firstLine: first + 1,
    code: lines.slice(first, first + length).join('\n'),
    highlight,
  };
}
export interface TechnicalStep {
  id: string;
  title: Translation;
  short: Translation;
  description: Translation;
  input: Translation;
  output: Translation;
  point: Translation;
  layers: string[];
  commands?: string;
  sources: SourceExcerpt[];
}

// The viewer displays excerpts from these allowlisted source imports. No runtime files,
// environment configuration, passwords, wallet keys or executable shell endpoints are exposed.
export const technicalSteps: TechnicalStep[] = [
  {
    id: 'install',
    short: both('Install', 'Установка'),
    title: both('1. Install and build the actual project', '1. Установить и собрать проект'),
    description: both(
      'Use Node.js 22.13+ and npm. npm ci installs the exact dependency versions from package-lock.json. The optional Anvil package supplies the local blockchain executable.',
      'Нужны Node.js 22.13+ и npm. Команда npm ci устанавливает точные версии зависимостей из package-lock.json. Исполняемый файл локального блокчейна Anvil поставляется отдельной npm-зависимостью.',
    ),
    input: both(
      'The GitHub repository and its lockfile.',
      'Исходники с GitHub и файл зафиксированных зависимостей.',
    ),
    output: both(
      'Installed packages, a built React client and compiled server. No transaction is sent.',
      'Установленные пакеты, собранный React-клиент и сервер. Транзакции ещё не отправляются.',
    ),
    point: both(
      'These are commands to run in a terminal on your computer. This page displays them; it does not execute commands on the shared server.',
      'Это команды для терминала на вашем компьютере. Страница показывает код и команды; она не запускает произвольные команды на общем сервере.',
    ),
    layers: ['client', 'server'],
    commands:
      'git clone https://github.com/ONI-COLLI/Artguard.git\ncd Artguard\nnpm ci\nnpm run build',
    sources: [excerpt('package.json', packageSource, '"build":', 6, '"build"')],
  },
  {
    id: 'chain',
    short: both('Blockchain', 'Блокчейн'),
    title: both(
      '2. Start Anvil and deploy the contracts',
      '2. Запустить Anvil и развернуть контракты',
    ),
    description: both(
      'Keep Terminal 1 open. The launcher starts Anvil on loopback port 8545, chain 31337. It restores saved state and reuses matching deployments; on a fresh network it compiles and deploys the contracts.',
      'Оставьте первый терминал открытым. Скрипт запускает Anvil на порту 8545 с chain ID 31337. Он восстанавливает сохранённое состояние и использует прежние контракты; в новой сети компилирует и разворачивает их.',
    ),
    input: both(
      'Solidity source, the local node and persisted deployment files when available.',
      'Код Solidity, локальный узел и сохранённые сведения о развёртывании, если они есть.',
    ),
    output: both(
      'Deployed registry and escrow contract addresses; node state in data/chain/state.json.',
      'Адреса реестра и escrow-контракта; состояние узла в data/chain/state.json.',
    ),
    point: both(
      'deployContract sends a real local-EVM transaction. Its successful receipt supplies the contract address. Anvil is a local node controlled by the operator, not a public decentralized network.',
      'deployContract отправляет настоящую транзакцию в локальную EVM. Адрес контракта берётся из успешной квитанции. Anvil контролируется оператором и не является публичной децентрализованной сетью.',
    ),
    layers: ['chain'],
    commands: '# Terminal 1\nnpm run chain',
    sources: [
      excerpt('scripts/local-chain.mjs', chainSource, 'const child = spawn(', 20, "'31337'"),
      excerpt(
        'scripts/deploy-escrow-marketplace.mjs',
        deploySource,
        "const contract = await compileContract('EscrowLicenseMarketplace')",
        10,
        'deployContract',
      ),
    ],
  },
  {
    id: 'client',
    short: both('Client + API', 'Клиент + API'),
    title: both('3. Start the React client and Node API', '3. Запустить React-клиент и Node API'),
    description: both(
      'In Terminal 2 prepare the fictional demo accounts, then run the development command. It starts Express on port 3000 and Vite on port 5173. Vite forwards /api and /media requests to Express.',
      'Во втором терминале подготовьте тестовые аккаунты и запустите режим разработки. Express работает на порту 3000, Vite — на 5173. Запросы /api и /media Vite перенаправляет серверу Express.',
    ),
    input: both(
      'The React entry point, API entry point and Vite proxy configuration.',
      'Точка входа React, точка входа API и настройки прокси Vite.',
    ),
    output: both(
      'Development UI: http://localhost:5173. API: http://localhost:3000/api/health.',
      'Клиент разработки: http://localhost:5173. API: http://localhost:3000/api/health.',
    ),
    point: both(
      'For the already-built app use npm start and open localhost:3000. The public HTTPS stand serves built React through Express; it does not expose the Vite dev server.',
      'Для собранного приложения выполните npm start и откройте localhost:3000. Публичный HTTPS-стенд отдаёт собранный React через Express; Vite там не публикуется.',
    ),
    layers: ['client', 'server', 'storage'],
    commands: '# Terminal 2, after the chain is ready\nnpm run demo:setup\nnpm run dev',
    sources: [
      excerpt('src/main.tsx', clientSource, '  createRoot(document.getElementById', 15, '<App />'),
      excerpt('server/index.ts', apiSource, 'import { createApp }', 11, '.listen('),
      excerpt('vite.config.ts', viteSource, 'export default defineConfig', 9, 'proxy:'),
    ],
  },
  {
    id: 'wallet',
    short: both('Connect wallet', 'Подключение кошелька'),
    title: both(
      '4. Connect and prove control of an external wallet',
      '4. Подключить внешний кошелёк и подтвердить владение',
    ),
    description: both(
      'Wagmi connects an injected browser wallet. The app switches it to chain 31337 when necessary. Connecting exposes a public address; linking to an ArtGuard account additionally requires a signed Sign-In with Ethereum (SIWE) message.',
      'Wagmi подключает кошелёк расширения браузера. При необходимости приложение предлагает сеть 31337. Подключение даёт публичный адрес; для привязки к аккаунту ArtGuard дополнительно нужна подпись сообщения Sign-In with Ethereum (SIWE).',
    ),
    input: both(
      'A signed-in account, a connected address and a fresh five-minute nonce.',
      'Аккаунт с сессией, подключённый адрес и свежий одноразовый запрос на 5 минут.',
    ),
    output: both(
      'A verified address in the wallets SQL table; no payment or on-chain transaction.',
      'Подтверждённый адрес в SQL-таблице wallets; без оплаты и транзакции в блокчейне.',
    ),
    point: both(
      'The nonce is bound to the account, session and domain and is consumed before verification to prevent reuse. The external private key stays in the wallet. Linking proves control of an address, not authorship or permission to charge it later; a purchase needs separate authorization.',
      'Одноразовый запрос привязан к аккаунту, сессии и домену и удаляется до проверки, чтобы исключить повтор. Приватный ключ внешнего кошелька остаётся в кошельке. Привязка подтверждает управление адресом, а не авторство или право списывать деньги позднее; покупку нужно подтвердить отдельно.',
    ),
    layers: ['client', 'server', 'storage'],
    sources: [
      excerpt(
        'src/lib/blockchain.ts',
        walletConfigSource,
        'export const walletConfig',
        9,
        'connectors:',
      ),
      excerpt(
        'src/components/wallet.tsx',
        walletSource,
        'async function linkWallet()',
        16,
        'sign.mutateAsync',
      ),
      excerpt(
        'server/blockchain.routes.ts',
        walletRoutesSource,
        'const nonce = randomBytes(16)',
        16,
        'createSiweMessage',
      ),
      excerpt(
        'server/blockchain.routes.ts',
        walletRoutesSource,
        '// Consume before asynchronous',
        19,
        'verifySiweMessage',
      ),
      excerpt(
        'server/blockchain.routes.ts',
        walletRoutesSource,
        "'INSERT OR IGNORE INTO wallets VALUES",
        6,
        'challenge.address',
      ),
    ],
  },
  {
    id: 'demo-wallet',
    short: both('Test wallets', 'Тестовые кошельки'),
    title: both(
      '5. How the prepared demo wallets sign',
      '5. Как подписывают подготовленные демо-кошельки',
    ),
    description: both(
      'The ArtGuard demo connector is a hosted test wallet. It looks like an Ethereum provider to wagmi but sends signing requests to the authenticated Express API. The API checks the assigned address, node instance and allowed application action before asking Anvil to sign or send.',
      'Демо-коннектор ArtGuard — тестовый кошелёк под управлением сервиса. Для wagmi он выглядит как Ethereum-провайдер, но отправляет запрос подписи в Express с текущей сессией. API проверяет назначенный адрес, экземпляр сети и разрешённое действие приложения, после чего просит Anvil подписать или отправить транзакцию.',
    ),
    input: both(
      'The current account session and an allowed request from its assigned test address.',
      'Сессия текущего аккаунта и разрешённый запрос от назначенного ему тестового адреса.',
    ),
    output: both(
      'A signature or real transaction hash from the local Anvil network.',
      'Подпись либо настоящий хеш транзакции локальной сети Anvil.',
    ),
    point: both(
      'This prototype mode is custodial: the operator controls the test node and its unlocked accounts. It is different from signing in a user-owned wallet extension. The browser receives results, not exported private keys. Test ETH has no monetary value.',
      'В этом режиме прототипа ключи контролирует оператор тестового узла, а аккаунты разблокированы в Anvil. Это отличается от подписи во внешнем кошельке пользователя. Браузер получает результат, а не экспорт приватного ключа. Test ETH не имеет денежной стоимости.',
    ),
    layers: ['client', 'server', 'chain'],
    sources: [
      excerpt(
        'src/lib/demo-wallet.ts',
        demoWalletSource,
        "if (['personal_sign'",
        8,
        "'/demo/wallet/rpc'",
      ),
      excerpt(
        'server/demo.routes.ts',
        demoRoutesSource,
        'const user = requireVerified(repo, requireUser(req));',
        9,
        'demoIdentity',
      ),
      excerpt(
        'server/demo.routes.ts',
        demoRoutesSource,
        "if (method === 'personal_sign')",
        21,
        'walletClient.signMessage',
      ),
      excerpt(
        'server/demo.routes.ts',
        demoRoutesSource,
        'const hash = await walletClient.sendTransaction',
        6,
        'account: address',
      ),
    ],
  },
  {
    id: 'storage',
    short: both('Data storage', 'Хранение данных'),
    title: both('6. Where each type of data is stored', '6. Где и в каком виде хранятся данные'),
    description: both(
      'There are separate storage layers: the browser session, SQLite, files on the server disk and EVM contract storage inside Anvil. The map below shows default local paths and formats, not the contents of anyone’s runtime data.',
      'Данные разделены между сессией браузера, SQLite, файлами на диске сервера и storage контрактов EVM внутри Anvil. Ниже — локальные пути по умолчанию и форматы, а не содержимое чьих-либо рабочих данных.',
    ),
    input: both(
      'Account records, original bytes, offers, transactions and license periods.',
      'Записи аккаунтов, байты оригиналов, предложения, транзакции и сроки лицензий.',
    ),
    output: both(
      'A SQL database and file storage off-chain; contract mappings and balances on-chain.',
      'SQL-база и файлы вне блокчейна; mapping и балансы контрактов — в блокчейне.',
    ),
    point: both(
      'ARTGUARD_DATA_DIR changes the base directory. The shared public stand uses runtime/public-demo instead of local data. The original file, email and password hash are not written to these contracts. The operator must preserve both the database/uploads and node state; one does not replace the other.',
      'ARTGUARD_DATA_DIR меняет базовую папку. Общий публичный стенд использует runtime/public-demo вместо локальной data. Оригинал, email и хеш пароля в эти контракты не записываются. Для восстановления оператору нужны и база с файлами, и состояние узла; одно не заменяет другое.',
    ),
    layers: ['client', 'server', 'storage', 'chain'],
    sources: [
      excerpt('server/app.ts', appSource, 'export async function createApp({', 21, 'const uploads'),
      excerpt(
        'server/database.ts',
        databaseSource,
        'export function openDatabase(',
        6,
        'new DatabaseSync',
      ),
      excerpt(
        'server/migrations.ts',
        schemaSource,
        'CREATE TABLE IF NOT EXISTS wallets (',
        9,
        'address TEXT',
      ),
      excerpt(
        'server/migrations.ts',
        schemaSource,
        'CREATE TABLE IF NOT EXISTS users (',
        19,
        'password_hash',
      ),
      excerpt(
        'server/migrations.ts',
        schemaSource,
        'CREATE TABLE IF NOT EXISTS chain_checkout_items (',
        12,
        'amount_wei',
      ),
      excerpt('server/auth.ts', authSource, 'export async function hashPassword(', 5, 'scrypt('),
      excerpt(
        'contracts/EscrowLicenseMarketplace.sol',
        escrowSource,
        'mapping(bytes32 => Escrow)',
        8,
        'mapping(',
      ),
      excerpt(
        'server/purchase.routes.ts',
        documentSource,
        "r.get('/licenses/:id/document'",
        31,
        ".type('text/plain')",
      ),
    ],
  },
  {
    id: 'fingerprint',
    short: both('File hash', 'Хеш файла'),
    title: both(
      '7. Upload a file and calculate its fingerprint',
      '7. Загрузить файл и вычислить отпечаток',
    ),
    description: both(
      'The original bytes reach Express as multipart form data. The server validates the file and calculates SHA-256 from its bytes. SQLite stores metadata; the original stays in protected server storage.',
      'Байты оригинала приходят в Express как multipart-форма. Сервер проверяет файл и вычисляет SHA-256 из его содержимого. Метаданные сохраняются в SQLite, а оригинал — в защищённом хранилище сервера.',
    ),
    input: both('The exact original file bytes.', 'Точные байты исходного файла.'),
    output: both(
      'A SHA-256 fingerprint and an off-chain project record.',
      'Отпечаток SHA-256 и запись о проекте вне блокчейна.',
    ),
    point: both(
      'The same bytes produce the same fingerprint. A changed byte normally changes it. A matching fingerprint identifies bytes; it does not prove legal authorship or detect visually similar images.',
      'Одинаковые байты дают одинаковый отпечаток. Изменение байта обычно меняет его. Совпадение подтверждает совпадение данных, но не доказывает юридическое авторство и не ищет визуально похожие картинки.',
    ),
    layers: ['client', 'server', 'storage'],
    sources: [
      excerpt(
        'server/artwork.routes.ts',
        uploadSource,
        "hash = createHash('sha256').update(file.buffer).digest('hex')",
        11,
        "createHash('sha256')",
      ),
    ],
  },
  {
    id: 'register',
    short: both('Register', 'Регистрация'),
    title: both(
      '8. Register the file with the creator wallet',
      '8. Зарегистрировать файл кошельком автора',
    ),
    description: both(
      'The creator authorizes registerArtwork(fileHash, termsHash). The contract rejects empty hashes and duplicate file registrations, then records the sending wallet, terms hash and block time.',
      'Автор подтверждает registerArtwork(fileHash, termsHash). Контракт отклоняет пустые хеши и повторную регистрацию файла, затем сохраняет кошелёк отправителя, хеш условий и время блока.',
    ),
    input: both(
      'The file hash, licensing-terms hash and a transaction from the creator wallet.',
      'Хеш файла, хеш условий лицензии и транзакция от кошелька автора.',
    ),
    output: both(
      'An ArtworkRegistered event and a registry record keyed by the file hash.',
      'Событие ArtworkRegistered и запись реестра с ключом по хешу файла.',
    ),
    point: both(
      'Uploading a project to SQLite is separate from registering it on-chain. The wallet signs a transaction; neither the original file nor personal account details are stored in this registry.',
      'Загрузка проекта в SQLite и регистрация в блокчейне — отдельные действия. Кошелёк подписывает транзакцию; оригинал файла и личные данные аккаунта в этот реестр не записываются.',
    ),
    layers: ['client', 'chain'],
    sources: [
      excerpt(
        'src/components/chain-registration.tsx',
        registrationSource,
        'const hash = await write.mutateAsync({',
        8,
        "functionName: 'registerArtwork'",
      ),
      excerpt(
        'contracts/ArtworkRegistry.sol',
        registrySource,
        'function registerArtwork(',
        7,
        'msg.sender',
      ),
    ],
  },
  {
    id: 'quote',
    short: both('Sign offer', 'Подпись оферты'),
    title: both(
      '9. Prepare a signed purchase offer',
      '9. Подготовить подписанное предложение покупки',
    ),
    description: both(
      'Express checks the project, buyer, plan commission and approved co-author shares. It builds a short-lived offer and signs the EIP-712 typed data with the platform signer.',
      'Express проверяет проект, покупателя, комиссию тарифа и согласованные доли соавторов. Сервер создаёт предложение с ограниченным сроком и подписывает EIP-712 данные кошельком сервиса.',
    ),
    input: both(
      'Buyer and seller wallets, file and terms hashes, amount, fee, shares, expiry and license period.',
      'Кошельки покупателя и автора, хеши файла и условий, сумма, комиссия, доли, срок предложения и период лицензии.',
    ),
    output: both(
      'A quote and signature. No funds or license are transferred by signing the offer.',
      'Предложение и подпись. Подписание предложения само по себе не перемещает деньги и не выдаёт лицензию.',
    ),
    point: both(
      'The quote expires after 10 minutes and is bound to its chain and contract. Changing the signed price, buyer or shares makes signature validation fail.',
      'Предложение действует 10 минут и привязано к сети и контракту. Изменение подписанной цены, покупателя или долей нарушает проверку подписи.',
    ),
    layers: ['server', 'storage'],
    sources: [
      excerpt(
        'server/chain-purchase.routes.ts',
        quoteSource,
        'const quote: LicenseQuote = {',
        17,
        'durationSeconds:',
      ),
      excerpt('server/blockchain.ts', signerSource, 'async signQuote(', 10, 'signTypedData'),
    ],
  },
  {
    id: 'deposit',
    short: both('Deposit', 'Депозит'),
    title: both('10. Send the purchase into escrow', '10. Отправить оплату в escrow'),
    description: both(
      'The buyer calls buyLicenses with the quote, signature and exact test ETH amount. The contract validates the sender, signature, expiry, registration, shares and quote reuse, then holds the deposit.',
      'Покупатель вызывает buyLicenses с предложением, подписью и точной суммой test ETH. Контракт проверяет отправителя, подпись, срок, регистрацию, доли и повторное использование предложения, затем удерживает депозит.',
    ),
    input: both(
      'The buyer transaction, signed quote and msg.value.',
      'Транзакция покупателя, подписанное предложение и msg.value.',
    ),
    output: both(
      'A funded escrow order and EscrowFunded event. The license is not active yet.',
      'Оплаченный escrow-заказ и событие EscrowFunded. Лицензия пока не активирована.',
    ),
    point: both(
      'EIP-712 verification binds the offer to its signer and exact fields. The registry owner is checked; full offered terms are authorized by the trusted platform signer. Invalid payment reverts the transaction.',
      'Проверка EIP-712 связывает предложение с подписантом и точными полями. Контракт сверяет владельца в реестре; условия предложения утверждает доверенный подписант сервиса. Неверная оплата откатывает транзакцию.',
    ),
    layers: ['client', 'chain'],
    sources: [
      excerpt(
        'src/components/blockchain-checkout.tsx',
        checkoutSource,
        'const transactionHash = await write.mutateAsync({',
        12,
        'value: BigInt',
      ),
      excerpt(
        'contracts/EscrowLicenseMarketplace.sol',
        escrowSource,
        'function buyLicenses(',
        33,
        'ECDSA.recover',
      ),
    ],
  },
  {
    id: 'delivery',
    short: both('Delivery & dispute', 'Передача и спор'),
    title: both(
      '11. Confirm delivery or open a dispute',
      '11. Подтвердить передачу или открыть спор',
    ),
    description: both(
      'Only the seller can call markDelivered while the funded order is within its 72-hour delivery window. That changes the state and starts a 24-hour buyer review. The buyer can dispute within that review window; the money remains in the contract.',
      'Только автор может вызвать markDelivered для оплаченного заказа до истечения 72 часов. Контракт меняет состояние и запускает 24 часа проверки покупателем. В этот срок покупатель может открыть спор; деньги остаются в контракте.',
    ),
    input: both(
      'A funded or delivered order, msg.sender and block.timestamp.',
      'Оплаченный или переданный заказ, msg.sender и block.timestamp.',
    ),
    output: both(
      'EscrowDelivered or EscrowDisputed and an updated deadline in contract storage.',
      'EscrowDelivered либо EscrowDisputed и новый срок в storage контракта.',
    ),
    point: both(
      'markDelivered is the seller’s on-chain statement, not automatic proof of file quality. The buyer reviews a protected preview; the original unlocks after release. A disputed order blocks ordinary release. The trusted platform arbiter can release or refund within 7 days; after that a refund transaction becomes available.',
      'markDelivered — заявление автора в блокчейне, а не автоматическое доказательство качества файла. Покупатель проверяет защищённое превью; оригинал открывается после release. Спор блокирует обычное завершение. Доверенный арбитр сервиса может завершить сделку или вернуть деньги в течение 7 дней; затем становится доступна транзакция возврата.',
    ),
    layers: ['client', 'chain'],
    sources: [
      excerpt(
        'contracts/EscrowLicenseMarketplace.sol',
        escrowSource,
        'function markDelivered(',
        17,
        'msg.sender',
      ),
      excerpt(
        'contracts/EscrowLicenseMarketplace.sol',
        escrowSource,
        'function resolveDispute(',
        7,
        'arbiter',
      ),
    ],
  },
  {
    id: 'release',
    short: both('Release', 'Завершение'),
    title: both(
      '12. Accept delivery, activate the license and allocate revenue',
      '12. Принять передачу, активировать лицензию и начислить доли',
    ),
    description: both(
      'The seller confirms delivery within 72 hours. The buyer has 24 hours to accept or dispute. Release activates the wallet-bound license and credits the platform, creator and co-author balances.',
      'Автор подтверждает передачу в течение 72 часов. У покупателя есть 24 часа на принятие или спор. Завершение активирует лицензию кошелька и начисляет доли сервису, автору и соавторам.',
    ),
    input: both(
      'The escrow order, its current state, deadline and the caller wallet.',
      'Escrow-заказ, его состояние, срок и кошелёк вызывающего.',
    ),
    output: both(
      'LicenseValidity and EscrowReleased events; contract credits for every recipient.',
      'События LicenseValidity и EscrowReleased; начисления получателям внутри контракта.',
    ),
    point: both(
      'The license key combines buyer, file hash and license type. Its period starts on release. The same transaction credits the shares. A dispute uses a trusted arbiter; timeouts enable transactions rather than sending them automatically.',
      'Ключ лицензии объединяет покупателя, хеш файла и тип лицензии. Срок начинается при завершении сделки. Эта же транзакция начисляет доли. Спор решает доверенный арбитр; таймеры только разрешают действия и не отправляют транзакции сами.',
    ),
    layers: ['chain', 'server', 'storage'],
    sources: [
      excerpt(
        'contracts/EscrowLicenseMarketplace.sol',
        escrowSource,
        'function release(bytes32 id)',
        7,
        '_release(id)',
      ),
      excerpt(
        'contracts/EscrowLicenseMarketplace.sol',
        escrowSource,
        'function _release(bytes32 id)',
        34,
        'balances[recipient] += share',
      ),
    ],
  },
  {
    id: 'refund',
    short: both('Refund', 'Возврат'),
    title: both(
      '13. Refund the buyer through the contract',
      '13. Вернуть деньги покупателю через контракт',
    ),
    description: both(
      'A seller can refund an unsettled order. A missed delivery deadline or unresolved dispute deadline enables a refund transaction. An arbiter can also choose a refund while a dispute is active. _refund credits the full deposit to refundBalances[buyer]; it does not immediately transfer ETH to the wallet.',
      'Автор может вернуть оплату незавершённого заказа. Пропуск срока передачи или решения спора разрешает транзакцию возврата. Арбитр также может выбрать возврат в открытом споре. _refund начисляет полный депозит в refundBalances[buyer], но не переводит ETH в кошелёк сразу.',
    ),
    input: both(
      'An unsettled escrow order and a caller allowed by its state and deadline.',
      'Незавершённый escrow-заказ и вызывающий, допустимый по состоянию и сроку.',
    ),
    output: both(
      'State refunded, an EscrowRefunded event and a buyer refund credit; no new license.',
      'Состояние refunded, событие EscrowRefunded и начисление возврата покупателю; без новой лицензии.',
    ),
    point: both(
      'The buyer separately calls withdrawRefund() to move their refund credit from the contract to their wallet. It clears the credit before sending. Gas costs are separate and are not returned as part of the deposited price.',
      'Покупатель отдельно вызывает withdrawRefund(), чтобы перевести начисленный возврат из контракта в свой кошелёк. Перед переводом начисление обнуляется. Сетевой gas — отдельный расход, который не входит в возврат цены.',
    ),
    layers: ['client', 'chain'],
    sources: [
      excerpt(
        'contracts/EscrowLicenseMarketplace.sol',
        escrowSource,
        'function refund(bytes32 id)',
        8,
        'bool expired',
      ),
      excerpt(
        'contracts/EscrowLicenseMarketplace.sol',
        escrowSource,
        'function _refund(bytes32 id)',
        7,
        'refundBalances',
      ),
      excerpt(
        'contracts/EscrowLicenseMarketplace.sol',
        escrowSource,
        'function withdrawRefund()',
        8,
        'refundBalances[msg.sender] = 0',
      ),
    ],
  },
  {
    id: 'withdraw',
    short: both('Withdraw', 'Вывод'),
    title: both(
      '14. Withdraw a creator or co-author credit',
      '14. Вывести начисление автора или соавтора',
    ),
    description: both(
      'Each recipient sends withdraw() from their own wallet. The contract reads that sender’s credit, clears it before transfer and sends the amount to that same wallet.',
      'Каждый получатель вызывает withdraw() своим кошельком. Контракт читает начисление отправителя, обнуляет его до перевода и отправляет сумму тому же кошельку.',
    ),
    input: both('msg.sender and balances[msg.sender].', 'msg.sender и balances[msg.sender].'),
    output: both(
      'A separate transfer and ProceedsWithdrawn event; available contract credit becomes zero.',
      'Отдельный перевод и событие ProceedsWithdrawn; доступное начисление в контракте становится нулевым.',
    ),
    point: both(
      'Allocation and withdrawal are distinct transactions. The nonReentrant guard and clearing the balance before the transfer protect this withdrawal path against reentrancy.',
      'Начисление и вывод — разные транзакции. Защита nonReentrant и обнуление баланса до перевода защищают этот путь вывода от повторного входа.',
    ),
    layers: ['chain', 'client'],
    sources: [
      excerpt(
        'contracts/EscrowLicenseMarketplace.sol',
        escrowSource,
        'function withdraw() external nonReentrant',
        8,
        'balances[msg.sender] = 0',
      ),
    ],
  },
  {
    id: 'verify',
    short: both('Verify', 'Проверка'),
    title: both(
      '15. Verify the transaction directly on the node',
      '15. Проверить транзакцию непосредственно на узле',
    ),
    description: both(
      'The public proof endpoint reads the transaction, receipt, canonical block, contract code, events and escrow state through Anvil RPC. It verifies the deposit, settlement and allocations before presenting a verified result.',
      'Публичная проверка читает транзакцию, квитанцию, канонический блок, код контракта, события и состояние escrow через RPC Anvil. Она сверяет депозит, завершение и начисления перед показом подтверждения.',
    ),
    input: both(
      'An escrow deposit transaction hash and the configured local node.',
      'Хеш транзакции депозита escrow и настроенный локальный узел.',
    ),
    output: both(
      'A live checklist of checks with timestamps and on-chain evidence in the proof panel below.',
      'Актуальный список проверок со временем и данными блокчейна в панели ниже.',
    ),
    point: both(
      'A database row alone is not proof of payment. Use the deposit hash in the existing escrow verification panel. The SQL accounting record is a copy; the node supplies the transaction evidence.',
      'Одна строка базы не подтверждает оплату. Укажите хеш депозита в существующей панели проверки escrow. Учётная запись SQL — копия; доказательства транзакции предоставляет узел.',
    ),
    layers: ['server', 'chain', 'storage'],
    commands: 'npm run test:unit -- --maxWorkers=2\nnpm run test:defense:contracts',
    sources: [
      excerpt(
        'server/escrow-proof.ts',
        proofSource,
        'const [tx, receipt] = await Promise.all',
        28,
        'getTransactionReceipt',
      ),
    ],
  },
];
