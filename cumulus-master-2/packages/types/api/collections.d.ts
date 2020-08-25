// eslint-disable-next-line import/extensions
import { DuplicateHandling } from '..';

export interface CollectionFile {
  bucket: string,
  regex: string,
  sampleFileName: string,
  checksumFor?: string
  type?: string,
  url_path?: string,
}

export interface PartialCollectionRecord {
  duplicateHandling?: DuplicateHandling,
  files?: CollectionFile[],
  granuleId?: string,
  granuleIdExtraction?: string,
  ignoreFilesConfigForDiscovery?: boolean,
  name?: string,
  process?: string,
  reportToEms?: boolean,
  sampleFileName?: string,
  tags?: string[],
  url_path?: string,
  version?: string
}

export interface NewCollectionRecord extends PartialCollectionRecord {
  files: CollectionFile[],
  granuleId: string,
  granuleIdExtraction: string,
  name: string,
  sampleFileName: string,
  version: string
}

export interface CollectionRecord extends NewCollectionRecord {
  createdAt: number,
  updatedAt: number
}
