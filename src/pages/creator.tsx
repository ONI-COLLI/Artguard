import { Link,useParams } from 'react-router-dom';
import { useQuery,useMutation,useQueryClient } from '@tanstack/react-query';
import type { Artwork } from '../../shared/types';
import { api } from '../lib/api';
import { useData,useFeedback } from '../lib/workspace';
import { ArtworkCard } from '../components/artwork';
import { Empty,PageHeading,Form,Field,Submit } from '../components/ui';
import { AccessPanel } from '../components/dialogs';
import { z } from 'zod';
type CreatorData={creator:{id:string;name:string;bio:string};total:number;artworks:Artwork[]};
export default function CreatorPage(){
 const {id}=useParams();
 const q=useQuery({queryKey:['creator',id],queryFn:()=>api<CreatorData>(`/creators/${id}`),retry:false});
 if(q.isPending)return <p role="status">Loading creator portfolio…</p>;
 if(!q.data)return <Empty title="Creator not found" description={q.error?.message||'This portfolio is unavailable.'}/>;
 const {creator,artworks,total}=q.data;
 return <>
  <section className="creator-hero panel"><span className="avatar creator-avatar">{creator.name[0]}</span><div><div className="eyebrow">Creator portfolio</div><h1>{creator.name}</h1><p>{creator.bio||'Explore this creator’s published work.'}</p><span className="muted small-text">{total} published projects</span></div></section>
  {artworks.length?<div className="art-grid">{artworks.map(a=><ArtworkCard key={a.id} artwork={a}/>)}</div>:<Empty title="No published projects yet" description="Published projects will appear in this portfolio."/>}
  {total>artworks.length&&<p className="muted">Showing the latest 100 published projects.</p>}
 </>;
}
export function FavoritesPage(){
 const data=useData();
 if(!data.user)return <AccessPanel/>;
 const items=data.artworks.filter(a=>a.favorite&&a.status==='published');
 return <><PageHeading kicker="Your collection" title="Favorites" description="Keep the work you like and return when you are ready."/>{items.length?<div className="art-grid">{items.map(a=><ArtworkCard key={a.id} artwork={a}/>)}</div>:<Empty title="Your collection starts here" description="Use the heart on an artwork to save it here."/>}</>;
}
export function PublicCreatorProfile(){
 const {user}=useData(),client=useQueryClient(),{notify}=useFeedback();
 const q=useQuery({queryKey:['creator',user?.id],queryFn:()=>api<CreatorData>(`/creators/${user!.id}`),enabled:!!user});
 const save=useMutation({mutationFn:(v:{bio:string})=>api('/creator/profile',{method:'PATCH',data:v}),onSuccess:()=>{void client.invalidateQueries({queryKey:['creator',user?.id]});notify({title:'Public profile saved'});}});
 if(!user||!q.data)return null;
 return <section className="panel public-profile-editor"><h3>Public creator profile</h3><p className="muted small-text">Only your public alias, bio and published projects appear here.</p><Link to={'/creator/'+user.id}>View public portfolio →</Link><Form key={user.id+q.data.creator.bio} schema={z.object({bio:z.string().trim().max(600)})} defaults={{bio:q.data.creator.bio}} onSubmit={async v=>{await save.mutateAsync({bio:v.bio});}}><Field name="bio" type="textarea" label="Public bio" maxLength={600}/><Submit>Save public bio</Submit></Form></section>;
}
