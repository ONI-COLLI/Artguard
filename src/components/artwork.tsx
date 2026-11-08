import { sessionUrl } from '../lib/session';
import { Link } from 'react-router-dom';
import { ArrowUpRight, MoreHorizontal } from 'lucide-react';
import type { Artwork } from '../../shared/types';
import { date, Empty } from './ui';
import { useDisplayCurrency } from './currency';
import { PromoteButton } from './promotions';
export function ArtworkCard({ artwork: a }: { artwork: Artwork }) {
  const { money } = useDisplayCurrency();
  return (
    <article className="art-card">
      <Link className="art-cover" to={'/artwork/' + a.id} aria-label={'View artwork: ' + a.title}>
        <img src={sessionUrl(a.image)} alt={a.title} loading="lazy" />
        <span className="cover-arrow">
          <ArrowUpRight size={17} />
        </span>
      </Link>
      <div className="art-meta">
        <span>{a.category}</span>
        <span>{a.licenses.length} licenses</span>
      </div>
      <Link className="art-title" to={'/artwork/' + a.id}>
        {a.title}
      </Link>
      {a.blockchain && <span className="chain-tag">Blockchain record</span>}
      <div className="art-card-bottom">
        <span>{a.author}</span>
        <strong>from {money(a.price)}</strong>
      </div>
    </article>
  );
}
export function ArtworkTable({ items }: { items: Artwork[] }) {
  const { money } = useDisplayCurrency();
  if (!items.length)
    return (
      <Empty
        title="A little space for something new."
        description="Publish your first artwork to start building your portfolio."
        to="/upload"
        label="Publish artwork"
      />
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {['Artwork', 'Category', 'Creator', 'Added', 'Starting price', 'Status', ''].map(
              (v, i) => (
                <th key={i} scope="col">
                  {v}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>
                <Link className="table-art" to={'/artwork/' + a.id}>
                  <img src={sessionUrl(a.image)} alt="" />
                  <span>{a.title}</span>
                </Link>
              </td>
              <td>{a.category}</td>
              <td>{a.author}</td>
              <td>{date(a.date)}</td>
              <td>{money(a.price)}</td>
              <td>
                <span className={'status ' + (a.status === 'draft' ? 'draft' : '')}>
                  <i />
                  {a.status === 'draft' ? 'Draft' : 'Published'}
                </span>
              </td>
              <td>
                <div className="artwork-row-actions">
                  {a.own && <PromoteButton artwork={a} />}
                  <Link
                    className="icon-link"
                    to={a.own ? '/edit/' + a.id : '/artwork/' + a.id}
                    aria-label={(a.own ? 'Edit ' : 'View ') + a.title}
                  >
                    {a.own ? <MoreHorizontal size={16} /> : <ArrowUpRight size={16} />}
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
