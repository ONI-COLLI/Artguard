export interface HomeSummary {
  updatedAt: string;
  completedTransactions: number;
  licensesIssued: number;
  projectsAvailable: number;
  licenseVolumeWei: string;
  featured: {
    id: string;
    title: string;
    author: string;
    category: string;
    image: string;
  } | null;
}
