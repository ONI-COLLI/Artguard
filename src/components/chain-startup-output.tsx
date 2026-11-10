import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { both, translated, type CodeLanguage } from '../lib/demo-language';
import { deploymentNames, type DeploymentStatus } from '../../shared/deployments';
import packageInfo from '../../package.json';
import { ShortHex } from './short-hex';

const notes: Partial<Record<keyof typeof deploymentNames, string>> = {
  registry: '. State saved under data/chain. Test ETH only.',
  marketplace: '. Test ETH checkout ready.',
  timed: '. Previous perpetual licenses preserved.',
  subscriptions: '. Prepaid 30-day test plans ready.',
  promotions: '. Paid 7-day placements ready.',
};

export function ChainStartupOutput({ language }: { language: CodeLanguage }) {
  const t = (en: string, ru: string) => translated(both(en, ru), language);
  const query = useQuery({
    queryKey: ['chain-deployments'],
    queryFn: () => api<DeploymentStatus>('/blockchain/deployments'),
    retry: false,
    staleTime: 10000,
    refetchInterval: 30000,
  });
  const data = !query.error && query.data?.contracts ? query.data : null;
  return (
    <div className="walkthrough-startup">
      <p className="walkthrough-output-note">
        {t(
          'Current deployment · verified via RPC, formatted like npm run chain.',
          'Текущее развёртывание · проверено через RPC, формат npm run chain.',
        )}
      </p>
      {query.isPending && <p role="status">{t('Reading the node…', 'Чтение узла…')}</p>}
      {query.error && (
        <p role="alert">
          {t(
            'Node data unavailable. No addresses confirmed.',
            'Данные узла недоступны. Адреса не подтверждены.',
          )}
        </p>
      )}
      {data && (
        <>
          <pre
            className="walkthrough-output"
            aria-label={t('Current deployment output', 'Вывод текущего развёртывания')}
          >
            <code>
              {`> ${packageInfo.name}@${packageInfo.version} chain\n> ${packageInfo.scripts.chain}\n\n`}
              {data.chainReady
                ? `ArtGuard local chain ready: ${data.rpcUrl} (chain ${data.chainId})\n`
                : t(
                    'Local blockchain unavailable. Start npm run chain.\n',
                    'Локальный блокчейн недоступен. Запусти npm run chain.\n',
                  )}
              {data.contracts.map((item) => (
                <span className="walkthrough-deployment-line" key={item.id}>
                  {deploymentNames[item.id]}:{' '}
                  {item.ready && item.address ? (
                    <>
                      <ShortHex value={item.address} />
                      {notes[item.id] || ''}
                      {'\n'}
                      {item.transactionHash && (
                        <>
                          {' '}
                          tx: <ShortHex value={item.transactionHash} /> · block {item.blockNumber}
                          {'\n'}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {t('not confirmed', 'не подтверждено')}
                      {'\n'}
                    </>
                  )}
                </span>
              ))}
            </code>
          </pre>
          <p className="walkthrough-output-note">
            {t('Checked', 'Проверено')}:{' '}
            {new Date(data.checkedAt).toLocaleTimeString(language === 'ru' ? 'ru-RU' : 'en-GB')}
            {' · '}
            {t('Hover for the full address or hash.', 'Полный адрес или хеш — при наведении.')}
          </p>
        </>
      )}
    </div>
  );
}
