import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand } from 'lucide-react';
import type { Artwork } from '../../shared/types';
import { sessionUrl } from '../lib/session';
import { Modal } from './ui';

export function ProjectGallery({ artwork }: { artwork: Artwork }) {
  const photos = [{ id: 'cover', url: artwork.image }, ...(artwork.gallery || [])];
  const [selected, setSelected] = useState('cover'),
    [expanded, setExpanded] = useState(false);
  const touch = useRef<[number, number] | null>(null),
    swipedAt = useRef(0);
  const root = useRef<HTMLElement>(null);
  const index = Math.max(
    0,
    photos.findIndex((photo) => photo.id === selected),
  );
  const photo = photos[index],
    multiple = photos.length > 1;
  useEffect(() => {
    root.current
      ?.querySelectorAll<HTMLElement>('.gallery-thumbnail[aria-pressed="true"]')
      .forEach((button) => {
        const track = button.parentElement!,
          item = button.getBoundingClientRect(),
          viewport = track.getBoundingClientRect();
        const distance =
          item.left < viewport.left
            ? item.left - viewport.left - 8
            : item.right > viewport.right
              ? item.right - viewport.right + 8
              : 0;
        if (distance) track.scrollBy?.({ left: distance, behavior: 'smooth' });
      });
  }, [index, expanded]);
  const move = (direction: number) =>
    setSelected(photos[(index + direction + photos.length) % photos.length].id);
  const stage = (large = false) => (
    <div
      className={`gallery-stage${large ? ' is-expanded' : ''}`}
      onTouchStart={(event) => {
        const t = event.touches[0];
        touch.current = [t.clientX, t.clientY];
      }}
      onTouchEnd={(event) => {
        if (!touch.current || !multiple) return;
        const t = event.changedTouches[0],
          dx = t.clientX - touch.current[0],
          dy = t.clientY - touch.current[1];
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          move(dx < 0 ? 1 : -1);
          swipedAt.current = Date.now();
        }
        touch.current = null;
      }}
    >
      {large ? (
        <img
          className="gallery-photo"
          src={sessionUrl(photo.url)}
          alt={`${artwork.title} — photo ${index + 1}`}
        />
      ) : (
        <button
          className="gallery-open"
          aria-label={`Enlarge photo ${index + 1} of ${artwork.title}`}
          onClick={() => {
            if (Date.now() - swipedAt.current > 400) setExpanded(true);
          }}
        >
          <img
            className="gallery-photo"
            src={sessionUrl(photo.url)}
            alt={`${artwork.title} — photo ${index + 1}`}
          />
          <span className="gallery-expand">
            <Expand size={17} aria-hidden="true" />
          </span>
        </button>
      )}
      {multiple && (
        <>
          <button
            className="gallery-arrow previous"
            aria-label="Previous photo"
            onClick={() => move(-1)}
          >
            <ChevronLeft size={22} />
          </button>
          <button className="gallery-arrow next" aria-label="Next photo" onClick={() => move(1)}>
            <ChevronRight size={22} />
          </button>
          <span
            className="gallery-count"
            role="status"
            aria-label={`Photo ${index + 1} of ${photos.length}`}
          >
            {index + 1} / {photos.length}
          </span>
        </>
      )}
    </div>
  );
  const thumbnails = () =>
    multiple && (
      <div className="gallery-thumbnails" aria-label="Project photo thumbnails">
        {photos.map((item, i) => (
          <button
            key={item.id}
            className="gallery-thumbnail"
            aria-label={`View photo ${i + 1}`}
            aria-pressed={i === index}
            onClick={() => setSelected(item.id)}
          >
            <img src={sessionUrl(item.url)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    );
  return (
    <section
      ref={root}
      className="project-gallery"
      aria-label="Project photos"
      onKeyDown={(event) => {
        if (multiple && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          move(event.key === 'ArrowRight' ? 1 : -1);
        }
      }}
    >
      {stage()}
      {thumbnails()}
      {expanded && (
        <Modal
          title={artwork.title}
          className="gallery-lightbox"
          onClose={() => setExpanded(false)}
        >
          {stage(true)}
          {thumbnails()}
        </Modal>
      )}
    </section>
  );
}
