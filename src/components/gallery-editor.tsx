import { useEffect, useId, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { ImagePlus, X } from 'lucide-react';
import type { Artwork } from '../../shared/types';
import { maxGalleryImages } from '../../shared/gallery';
import { sessionUrl } from '../lib/session';
const emptyFiles: File[] = [];

export function GalleryEditor({ artwork }: { artwork?: Artwork }) {
  const {
    watch,
    setValue,
    formState: { errors },
  } = useFormContext();
  const id = useId(),
    files: File[] = watch('galleryFiles') || emptyFiles,
    keep: string[] = watch('retainedGallery') || [];
  const [previews, setPreviews] = useState<string[]>([]);
  const saved = (artwork?.gallery || []).filter((photo) => keep.includes(photo.id));
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);
  const update = (name: string, value: unknown) =>
    setValue(name, value, { shouldDirty: true, shouldValidate: true });
  const error = errors.galleryFiles?.message || errors.retainedGallery?.message;
  return (
    <div className="gallery-editor">
      <div className="gallery-editor-heading">
        <label htmlFor={id}>Additional photos</label>
        <span>
          {saved.length + files.length} / {maxGalleryImages}
        </span>
      </div>
      <div className="gallery-editor-photos">
        {artwork?.image && (
          <div className="gallery-editor-photo">
            <img src={sessionUrl(artwork.image)} alt="Original cover" />
            <span>Cover</span>
          </div>
        )}
        {saved.map((photo, i) => (
          <div className="gallery-editor-photo" key={photo.id}>
            <img src={sessionUrl(photo.url)} alt={`Saved additional photo ${i + 1}`} />
            <button
              type="button"
              aria-label={`Remove saved photo ${i + 1}`}
              onClick={() =>
                update(
                  'retainedGallery',
                  keep.filter((id) => id !== photo.id),
                )
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {files.map((file, i) => (
          <div className="gallery-editor-photo" key={`${i}-${file.name}`}>
            <img src={previews[i]} alt={`New photo: ${file.name}`} />
            <button
              type="button"
              aria-label={`Remove new photo ${i + 1}`}
              onClick={() =>
                update(
                  'galleryFiles',
                  files.filter((_, n) => n !== i),
                )
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <label className="gallery-add" htmlFor={id}>
        <ImagePlus size={17} /> Add photos
      </label>
      <input
        id={id}
        className="sr-only"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        aria-label="Additional photos"
        onChange={(event) => {
          update('galleryFiles', [...files, ...Array.from(event.target.files || [])]);
          event.target.value = '';
        }}
      />
      <small className="field-hint">
        Up to 7 additional photos · PNG, JPG or WEBP · 10 MB each.
      </small>
      {error && (
        <p className="field-error" role="alert">
          {String(error)}
        </p>
      )}
    </div>
  );
}
