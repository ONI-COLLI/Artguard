import { expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
it('preserves PATCH when uploading additional project photos with progress', async () => {
  const open = vi.fn();
  class Upload {
    upload: any = {};
    status = 200;
    responseText = '{"saved":true}';
    timeout = 0;
    open = open;
    onload?: () => void;
    send() {
      this.onload?.();
    }
  }
  vi.stubGlobal('XMLHttpRequest', Upload);
  try {
    expect(
      await api('/artworks/project', {
        method: 'PATCH',
        data: new FormData(),
        onProgress: vi.fn(),
      }),
    ).toEqual({ saved: true });
    expect(open.mock.calls[0][0]).toBe('PATCH');
  } finally {
    vi.unstubAllGlobals();
  }
});
