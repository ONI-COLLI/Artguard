import { both } from './demo-language';

const explanations = [
  {
    prefix: 'Deposit succeeded at a configured escrow contract',
    title: both(
      'Payment succeeded at the escrow contract',
      'Оплата успешно дошла до escrow-контракта',
    ),
    detail: both(
      'RPC transaction and receipt must identify the same sender, contract and transaction hash. The receipt status must be success, not reverted.',
      'Транзакция и квитанция из RPC должны совпасть по отправителю, контракту и хешу. Статус квитанции должен быть success, а не откат.',
    ),
  },
  {
    prefix: 'Deposit belongs to the canonical block',
    title: both(
      'The transaction is in the node’s current chain',
      'Транзакция находится в текущей цепочке узла',
    ),
    detail: both(
      'The receipt block hash is compared with the block currently stored at that height. The block must contain this transaction, and the destination must have deployed code.',
      'Хеш блока из квитанции сравнивается с текущим блоком на той же высоте. В нём должна быть эта транзакция, а у адреса получателя должен существовать код контракта.',
    ),
  },
  {
    prefix: 'Transaction calls buyLicenses',
    title: both('It is an escrow deposit call', 'Это вызов оплаты escrow'),
    detail: both(
      'The transaction input is decoded using the contract ABI. The called function must be buyLicenses, not a random ETH transfer or a release transaction.',
      'Входные данные транзакции расшифровываются по ABI контракта. Вызванная функция должна быть buyLicenses, а не случайный перевод ETH или завершение сделки.',
    ),
  },
  {
    prefix: 'Transferred amount equals',
    title: both(
      'The ETH amount matches the offered prices',
      'Сумма ETH совпадает с ценами предложений',
    ),
    detail: both(
      'The verifier adds the amount field of every quote in the transaction and compares the total in wei with tx.value.',
      'Проверка складывает поле amount всех предложений в транзакции и сравнивает итог в wei с tx.value.',
    ),
  },
  {
    prefix: 'EscrowFunded events match',
    title: both(
      'The deposit event matches the purchase fields',
      'Событие депозита совпадает с данными покупки',
    ),
    detail: both(
      'EscrowFunded logs from this contract are compared with the transaction’s quote: buyer, seller, file and terms hashes, type, amount, fee, license duration and delivery deadline.',
      'Логи EscrowFunded именно этого контракта сравниваются с предложением в транзакции: покупатель, автор, хеши файла и условий, тип, цена, комиссия, срок лицензии и передачи.',
    ),
  },
  {
    prefix: 'Contract storage and consumed quote match order',
    title: both(
      'The contract actually stores this order',
      'Контракт действительно хранит этот заказ',
    ),
    detail: both(
      'RPC reads getEscrow(id) and usedQuotes(id). The stored parties, file, amount, type, period and valid state must match, and the quote must be marked used.',
      'RPC читает getEscrow(id) и usedQuotes(id). Стороны, файл, сумма, тип, срок и допустимое состояние должны совпасть, а предложение должно быть отмечено использованным.',
    ),
  },
  {
    prefix: 'A unique on-chain settlement event exists',
    title: both(
      'A separate release or refund was recorded',
      'Записано отдельное завершение или возврат',
    ),
    detail: both(
      'The node is searched for EscrowReleased or EscrowRefunded for this order ID. Exactly one matching settlement event with a transaction hash must exist.',
      'На узле ищется EscrowReleased или EscrowRefunded по ID этого заказа. Должно существовать ровно одно соответствующее событие с хешем транзакции.',
    ),
  },
  {
    prefix: 'Settlement transaction succeeded',
    title: both('The settlement transaction succeeded', 'Транзакция завершения прошла успешно'),
    detail: both(
      'The settlement has its own receipt. Its status must be success and its destination must be the escrow contract. A deposit receipt alone cannot prove release.',
      'У завершения есть собственная квитанция. Её статус должен быть success, а адрес получателя — escrow-контракт. Квитанция депозита сама по себе не доказывает выплату.',
    ),
  },
  {
    prefix: 'License and period were issued on release',
    title: both('The license starts at release', 'Лицензия начинается при завершении'),
    detail: both(
      'LicensePurchased and LicenseValidity events in the release receipt are compared with the original quote. Valid-from and expiry must match the purchased period. This does not mean the license is still unexpired today; the current status is read separately.',
      'События LicensePurchased и LicenseValidity в квитанции завершения сравниваются с исходным предложением. Начало и окончание должны соответствовать купленному сроку. Это не означает, что лицензия ещё действует сегодня; текущий статус читается отдельно.',
    ),
  },
  {
    prefix: 'All creator and co-author allocations match',
    title: both(
      'Creator and co-author credits match the split',
      'Начисления автору и соавторам совпадают с долями',
    ),
    detail: both(
      'The verifier subtracts the commission, recomputes each signed share using integer wei and compares recipient, amount and basis points with RevenueAllocated events. These are contract credits, not proof of a later withdrawal to a wallet.',
      'Проверка вычитает комиссию, заново считает каждую подписанную долю в целых wei и сверяет получателя, сумму и долю с RevenueAllocated. Это начисления внутри контракта, а не доказательство последующего вывода в кошелёк.',
    ),
  },
  {
    prefix: 'Refund event returns the full',
    title: both('The full price was credited for refund', 'Полная цена начислена к возврату'),
    detail: both(
      'EscrowRefunded must reference this order, its buyer and the entire deposited amount. ETH reaches the wallet only after the separate withdrawRefund transaction.',
      'EscrowRefunded должен ссылаться на этот заказ, его покупателя и полный депозит. ETH поступает в кошелёк только после отдельной транзакции withdrawRefund.',
    ),
  },
];
export const explainEscrowCheck = (label: string) =>
  explanations.find((item) => label.startsWith(item.prefix));
