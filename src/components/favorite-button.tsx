import { Heart } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Artwork, Workspace } from '../../shared/types';
import { api } from '../lib/api';
import { useData, useFeedback, workspaceKey } from '../lib/workspace';

export function FavoriteButton({artwork,compact=false}:{artwork:Artwork;compact?:boolean}) {
  const data=useData(),client=useQueryClient(),{notify}=useFeedback();
  const saved=!!(data.artworks.find(a=>a.id===artwork.id)||artwork).favorite;
  const action=useMutation({
    mutationFn:()=>api<Workspace>(`/artworks/${artwork.id}/favorite`,{method:'PUT',data:{saved:!saved}}),
    onSuccess:next=>client.setQueryData(workspaceKey,next),
    onError:e=>notify({title:'Could not update favorites',detail:e.message}),
  });
  if(!data.user)return null;
  return <button type="button" className={`favorite-button${compact?' compact':''}${saved?' is-saved':''}`}
    aria-label={saved?'Remove from favorites':'Save to favorites'} aria-pressed={saved}
    disabled={action.isPending} onClick={()=>action.mutate()}>
    <Heart size={17} fill={saved?'currentColor':'none'}/>{!compact&&<span>{saved?'Saved':'Save'}</span>}
  </button>;
}
