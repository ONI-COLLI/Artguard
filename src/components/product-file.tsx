import { useFormContext } from 'react-hook-form';
import { FileArchive, X } from 'lucide-react';
import { productFileAccept, fileSize } from '../../shared/files';
import type { Artwork, LicenseId } from '../../shared/types';
import { licenseTypes } from '../../shared/schemas';
import { licensePeriodLabel } from '../../shared/marketplace';

export function ProductFileInput() {
  const { register, watch, setValue, formState: { errors } } = useFormContext();
  const file = (watch('productFile') as FileList | undefined)?.[0];
  return <section className="product-file-field">
    <label className="product-file-picker">
      <FileArchive size={23} aria-hidden="true" />
      <span><strong>Downloadable product file</strong><small>{file ? `${file.name} · ${fileSize(file.size)}` : 'Optional · PNG, JPG, WEBP, PDF or ZIP · up to 20 MB'}</small></span>
      <input className="file-input" type="file" aria-label="Product file" accept={productFileAccept} {...register('productFile')} />
    </label>
    {file && <button className="text-button" type="button" onClick={() => setValue('productFile', undefined, {shouldDirty:true})}><X size={13}/> Use cover as the product</button>}
    <p className="field-hint">Buyers see the cover. The original product file unlocks with an active license. Without a separate file, the cover image is the product.</p>
    {errors.productFile && <p role="alert" className="field-error">{String(errors.productFile.message)}</p>}
  </section>;
}
export function WhatYouGet({artwork:a,license}:{artwork:Artwork;license:LicenseId}) {
  return <section className="product-delivery" aria-label="What you get">
    <h3>What you get</h3>
    <div className="delivery-facts">
      <span><strong>{a.format}</strong> · {fileSize(a.size)}</span>
      {a.dimensions && <span>{a.dimensions.width} × {a.dimensions.height} px</span>}
      <span>{licensePeriodLabel(a.licenseDurationDays || 0)}</span>
    </div>
    <p>{licenseTypes[license].description}</p>
    {['PDF','ZIP'].includes(a.format) && <small>The gallery shows cover previews. PDF/ZIP contents are delivered as a download after release.</small>}
  </section>;
}
