export type Point = { x: number; y: number };

export type FilterType = 'original' | 'magic' | 'document' | 'photo' | 'bw';

export interface DocumentPage {
  id: string;
  originalImage: string; // The full uncropped image from camera/gallery
  croppedImage: string; // The perspective warped image
  filteredImage: string; // The final image with filter applied
  filter: FilterType;
  corners: Point[];
}

export interface Document {
  id: string;
  title: string;
  createdAt: number;
  pages: DocumentPage[];
  folderId?: string; // Optional folder
  pin?: string;
  isLocked?: boolean;
  isTrash?: boolean;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export interface WatermarkOptions {
  text: string;
  size: number;
  color: string;
  opacity: number;
  style: 'single' | 'grid';
  position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export interface QueueItem {
  url: string;
  corners?: Point[] | null;
}
