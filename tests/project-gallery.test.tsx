import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectGallery } from '../src/components/project-gallery';
const artwork: any = {
  id: 'gallery-project',
  title: 'Detailed project',
  image: '/media/cover',
  gallery: [
    { id: 'detail', url: '/media/detail' },
    { id: 'closeup', url: '/media/closeup' },
  ],
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
it('cycles through the actual project photos with arrows, thumbnails and keyboard', async () => {
  render(<ProjectGallery artwork={artwork} />);
  const photo = () => screen.getByRole('img', { name: /Detailed project — photo/ });
  expect(photo()).toHaveAttribute('src', expect.stringContaining('/media/cover'));
  await userEvent.click(screen.getByRole('button', { name: 'Next photo' }));
  expect(photo()).toHaveAttribute('src', expect.stringContaining('/media/detail'));
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('status')).toHaveAccessibleName('Photo 3 of 3');
  await userEvent.click(screen.getByRole('button', { name: 'Next photo' }));
  expect(photo()).toHaveAttribute('src', expect.stringContaining('/media/cover'));
  await userEvent.click(screen.getByRole('button', { name: 'View photo 3' }));
  expect(photo()).toHaveAttribute('src', expect.stringContaining('/media/closeup'));
  expect(screen.getByRole('button', { name: 'View photo 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
it('opens a large view of the selected photo with working navigation', async () => {
  render(<ProjectGallery artwork={artwork} />);
  await userEvent.click(screen.getByRole('button', { name: 'View photo 2' }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Enlarge photo 2 of Detailed project' }),
  );
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('img', { name: /photo 2/ })).toHaveAttribute(
    'src',
    expect.stringContaining('/media/detail'),
  );
  await userEvent.click(within(dialog).getByRole('button', { name: 'Previous photo' }));
  expect(within(dialog).getByRole('img', { name: /photo 1/ })).toHaveAttribute(
    'src',
    expect.stringContaining('/media/cover'),
  );
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('keeps existing projects with one image free of empty carousel controls', () => {
  render(<ProjectGallery artwork={{ ...artwork, gallery: [] }} />);
  expect(screen.queryByRole('button', { name: 'Next photo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'View photo 1' })).not.toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringContaining('/media/cover'));
});
it('changes photos on a horizontal swipe without opening the large viewer', () => {
  render(<ProjectGallery artwork={artwork} />);
  const stage = screen
    .getByRole('region', { name: 'Project photos' })
    .querySelector('.gallery-stage')!;
  fireEvent.touchStart(stage, { touches: [{ clientX: 250, clientY: 150 }] });
  fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 100, clientY: 155 }] });
  expect(screen.getByRole('img')).toHaveAccessibleName('Detailed project — photo 2');
  fireEvent.click(screen.getByRole('button', { name: 'Enlarge photo 2 of Detailed project' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
