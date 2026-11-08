import { sessionUrl } from '../lib/session';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useFormContext } from 'react-hook-form';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowRight, Upload, Shield, Check, Clock } from 'lucide-react';
import { artworkSchema, categories, licenseTypes } from '../../shared/schemas';
import type { Workspace, Artwork } from '../../shared/types';
import { api, type UploadProgress } from '../lib/api';
import { useData, useAction, useFeedback, workspaceKey, errorText } from '../lib/workspace';
import { useDialog, AccessPanel } from '../components/dialogs';
import { Form, Field, Submit, Rights, PageHeading, Button, Empty } from '../components/ui';
import { ProjectRecipients } from '../components/project-recipients';
import { ShareStatusCard } from './coauthors';
import { GalleryEditor } from '../components/gallery-editor';
import { maxGalleryImages, maxGalleryImageBytes, galleryMimeTypes } from '../../shared/gallery';
import { detailedUsage, licensePeriodRule } from '../../shared/license-terms';
function Licenses() {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  return (
    <>
      <span className="field-label">Available licenses</span>
      {Object.entries(licenseTypes).map(([key, v]) => (
        <label className="license-option" key={key}>
          <input type="checkbox" value={key} {...register('licenses')} />
          <div>
            <strong>{v.title}</strong>
            <span>{v.description}</span>
          </div>
          <b>× {v.factor}</b>
        </label>
      ))}
      {errors.licenses && (
        <p className="field-error" role="alert">
          {String(errors.licenses.message)}
        </p>
      )}
    </>
  );
}
function ImageInput() {
  const {
      register,
      setValue,
      watch,
      formState: { errors },
    } = useFormContext(),
    files = watch('file') as FileList | undefined,
    [url, setUrl] = useState('');
  const file = files?.[0];
  useEffect(() => {
    if (!file) {
      setUrl('');
      return;
    }
    const object = URL.createObjectURL(file);
    setUrl(object);
    return () => URL.revokeObjectURL(object);
  }, [file]);
  return (
    <>
      <label
        className="upload-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setValue('file', e.dataTransfer.files, { shouldDirty: true, shouldValidate: true });
        }}
      >
        <div id="upload-preview">
          {url ? (
            <img src={sessionUrl(url)} alt="Selected artwork preview" />
          ) : (
            <Upload size={30} />
          )}
          <strong>{file ? file.name : 'Drop your artwork here'}</strong>
          <span>
            {file
              ? `${(file.size / 1024 / 1024).toFixed(2)} MB · Click to change`
              : 'or choose a file from your computer'}
          </span>
        </div>
        <input
          aria-label="Artwork file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          {...register('file')}
        />
        <small>PNG, JPG, WEBP · up to 20 MB</small>
      </label>
      {errors.file && (
        <p className="field-error" role="alert">
          {String(errors.file.message)}
        </p>
      )}
      <div className="upload-readiness">
        <span className={file ? 'complete' : ''}>
          {file ? <Check size={13} /> : <Clock size={13} />} Image selected
        </span>
        <span className={watch('rights') ? 'complete' : ''}>
          {watch('rights') ? <Check size={13} /> : <Clock size={13} />} Rights confirmed
        </span>
      </div>
    </>
  );
}
function DeleteArtwork({ artwork: a }: { artwork: Artwork }) {
  const mutation = useAction(`/artworks/${a.id}`, 'DELETE'),
    navigate = useNavigate(),
    { close } = useDialog(),
    { notify } = useFeedback();
  return (
    <>
      <p className="muted">
        This removes the artwork and source file. Artwork with existing licenses or blockchain
        records can only be unpublished.
      </p>
      {mutation.isError && (
        <p className="form-error" role="alert">
          {errorText(mutation.error)}
        </p>
      )}
      <div className="actions">
        <Button onClick={close}>Keep artwork</Button>
        <Button
          className="primary"
          busy={mutation.isPending}
          onClick={async () => {
            try {
              await mutation.mutateAsync({});
              close();
              navigate('/works');
              notify({ title: 'Artwork deleted' });
            } catch {
              /* displayed above */
            }
          }}
        >
          Delete permanently
        </Button>
      </div>
    </>
  );
}
export default function Editor() {
  const { id } = useParams(),
    d = useData(),
    a = id ? d.artworks.find((v) => v.id === id && v.own) : undefined,
    navigate = useNavigate(),
    client = useQueryClient(),
    dialog = useDialog(),
    { notify } = useFeedback(),
    [progress, setProgress] = useState<UploadProgress | null>(null);
  const save = useMutation({
    mutationFn: ({ data, edit }: { data: FormData | Record<string, unknown>; edit: boolean }) =>
      api<Workspace & { artwork?: Artwork }>(edit ? `/artworks/${id}` : '/artworks', {
        method: edit ? 'PATCH' : 'POST',
        data,
        onProgress: data instanceof FormData ? setProgress : undefined,
      }),
    onSuccess: (next) => client.setQueryData(workspaceKey, next),
    onError: () => setProgress(null),
  });
  if (!d.user)
    return (
      <>
        <PageHeading
          kicker="For creators"
          title="Your next great release."
          description="Sign in to start publishing your work."
        />
        <AccessPanel />
      </>
    );
  if (id && !a)
    return (
      <Empty
        title="Artwork not found"
        description="You can only edit artwork from your own portfolio."
        to="/works"
        label="My artwork"
      />
    );
  const plan = d.plans[d.user.plan],
    count = d.artworks.filter((v) => v.own).length,
    full = !a && count >= plan.limit;
  const schema = (
    a
      ? artworkSchema
      : artworkSchema.extend({
          rights: z.literal(true, { error: 'Confirm your right to publish this artwork.' }),
          file: z
            .custom<FileList>()
            .refine((v) => !!v?.[0], 'Choose an artwork image.')
            .refine(
              (v) => !v?.[0] || (v[0].size > 0 && v[0].size <= 20 * 1024 * 1024),
              'Choose a nonempty image up to 20 MB.',
            )
            .refine(
              (v) => !v?.[0] || ['image/png', 'image/jpeg', 'image/webp'].includes(v[0].type),
              'Use PNG, JPG, or WEBP.',
            ),
        })
  )
    .extend({
      retainedGallery: z.array(z.string()).max(maxGalleryImages).default([]),
      galleryFiles: z
        .array(z.custom<File>())
        .max(maxGalleryImages, 'Use up to 7 additional photos.')
        .refine(
          (files) => files.every((file) => file.size > 0 && file.size <= maxGalleryImageBytes),
          'Each additional photo must be a nonempty image up to 10 MB.',
        )
        .refine(
          (files) =>
            files.every((file) =>
              galleryMimeTypes.includes(file.type as (typeof galleryMimeTypes)[number]),
            ),
          'Use PNG, JPG, or WEBP for additional photos.',
        )
        .default([]),
    })
    .refine((v) => v.retainedGallery.length + v.galleryFiles.length <= maxGalleryImages, {
      message: 'Use up to 7 additional photos.',
      path: ['galleryFiles'],
    })
    .refine(
      (v) =>
        !d.user?.wallet ||
        !v.recipients.some(
          (r) => r.wallet?.toLowerCase() === d.user!.wallet!.address.toLowerCase(),
        ),
      { message: 'Co-author wallets must differ from your creator wallet.', path: ['recipients'] },
    );
  return (
    <>
      <PageHeading
        kicker={a ? 'A little refinement' : 'Create something worth sharing'}
        title={a ? 'Refine your artwork.' : 'Publish your artwork.'}
        description="Add the details. Set your terms. Make it yours."
      />
      {full && (
        <div className="local-note">
          Your upload limit is reached. <Link to="/pricing">Choose another plan</Link> to add more
          artwork.
        </div>
      )}
      <div className="upload-layout">
        <Form
          key={id || 'new'}
          className="panel form-panel"
          warnUnsaved
          schema={schema}
          defaults={
            a
              ? {
                  ...a,
                  recipients: a.recipients || [],
                  retainedGallery: (a.gallery || []).map((photo) => photo.id),
                  galleryFiles: [],
                }
              : {
                  title: '',
                  description: '',
                  category: 'Illustration',
                  price: '',
                  licenses: ['personal'],
                  licenseDurationDays: 0,
                  status: 'published',
                  rights: false,
                  recipients: d.user.recipients.map((r) => ({ ...r })),
                  retainedGallery: [],
                  galleryFiles: [],
                }
          }
          onSubmit={async (v, form) => {
            setProgress(null);
            const { galleryFiles, ...details } = v;
            let data: FormData | Record<string, unknown> = details;
            if (!a || galleryFiles.length) {
              const f = new FormData();
              for (const key of [
                'title',
                'description',
                'category',
                'price',
                'status',
                'licenseDurationDays',
              ])
                f.append(key, String(v[key]));
              for (const k of v.licenses) f.append('licenses', k);
              f.append('recipients', JSON.stringify(v.recipients));
              f.append('retainedGallery', JSON.stringify(v.retainedGallery));
              for (const file of galleryFiles) f.append('gallery', file);
              if (!a) {
                f.append('file', (v.file as FileList)[0]);
                f.append('rights', 'true');
              }
              data = f;
            }
            const next = await save.mutateAsync({ data, edit: !!a });
            form.reset(v);
            const target = a?.id || next.artwork!.id;
            const stored = next.artworks.find((art) => art.id === target) || next.artwork;
            const pendingShares =
              stored?.status === 'draft' && stored.shareApproval?.ready === false;
            navigate('/artwork/' + target);
            notify({
              title:
                stored?.status === 'draft'
                  ? 'Draft saved'
                  : a
                    ? 'Artwork updated'
                    : 'Artwork published',
              detail: pendingShares
                ? 'Waiting for every co-author to approve this split. Publish it after the approvals are complete.'
                : v.status === 'draft'
                  ? 'Only you and existing license holders can access this artwork.'
                  : 'Your latest details are visible in the marketplace.',
              href: '/works',
              label: 'Manage artwork',
            });
          }}
        >
          {!a && <ImageInput />}
          <GalleryEditor artwork={a} />
          <div className="section-label">
            01 <span>Artwork details</span>
          </div>
          <Field name="title" label="Title" placeholder="Give your work a name" maxLength={100} />
          <Field name="description" label="Description" type="textarea" maxLength={1500} />
          <div className="form-grid">
            <Field name="category" label="Category" options={categories} />
            <Field
              name="price"
              label="Base license price, USD"
              type="number"
              min={1}
              max={100000}
              step="0.01"
            />
          </div>
          <div className="section-label">
            02 <span>Your licensing terms</span>
          </div>
          <Licenses />
          <details className="usage-details">
            <summary>Exact usage rights for new projects</summary>
            {Object.entries(detailedUsage).map(([id, text]) => (
              <p key={id}>
                <strong>{licenseTypes[id as keyof typeof licenseTypes].title}: </strong>
                {text}
              </p>
            ))}
            <p>{licensePeriodRule}</p>
            <p>
              Confirm permissions for any depicted people, trademarks and third-party materials. A
              file fingerprint is not proof of authorship.
            </p>
          </details>
          <Field
            name="licenseDurationDays"
            label="License period"
            options={[
              { value: '0', label: 'Perpetual' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '365', label: '1 year' },
            ]}
          />
          <p className="field-hint">
            Starts when escrow is released. Changes apply to future purchases; existing license
            periods are preserved.
          </p>
          <div className="section-label">
            03 <span>Project co-authors</span>
          </div>
          <ProjectRecipients />
          <Field
            name="status"
            label="Visibility"
            options={[
              { value: 'published', label: 'Publish to marketplace' },
              { value: 'draft', label: 'Save as draft' },
            ]}
          />
          {!a && <Rights />}
          {progress && (
            <div className="form-request-status" role="status">
              {progress.processing
                ? 'Files transferred. Saving your artwork…'
                : `Uploading file · ${progress.percent}%`}
              <progress value={progress.percent} max={100} />
            </div>
          )}
          <div className="form-footer">
            <Link to="/works">Cancel</Link>
            {!full && (
              <Submit>
                Save artwork <ArrowRight size={16} />
              </Submit>
            )}
          </div>
          {a && (
            <button
              className="text-button danger-link"
              type="button"
              onClick={() => dialog.open('Delete this artwork?', <DeleteArtwork artwork={a} />)}
            >
              Delete artwork
            </button>
          )}
        </Form>
        <aside>
          {a && <ShareStatusCard artwork={a} />}
          <div className="panel upload-tip">
            <span className="stat-icon">
              <Shield size={25} />
            </span>
            <h3>Your work. Your ownership.</h3>
            <p>We calculate a SHA-256 fingerprint and save the file on this computer.</p>
            <hr />
            <div className="eyebrow">Your workspace</div>
            <h2>{plan.name}</h2>
            <p>
              {count} of {plan.limit === 5 ? '5' : 'unlimited'} uploads used
            </p>
            <Link className="small-link" to="/pricing">
              Explore plans <ArrowRight size={14} />
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
