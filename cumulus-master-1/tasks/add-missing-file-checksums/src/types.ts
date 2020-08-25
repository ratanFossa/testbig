export interface GranuleFile {
  checksumType?: string,
  checksum?: string,
  filename: string,
  [key: string]: unknown
}

export interface Granule {
  files: GranuleFile[],
  [key: string]: unknown
}

export interface HandlerInput {
  granules: Granule[],
  [key: string]: unknown
}

export interface HandlerEvent {
  config: {
    algorithm: string
  },
  input: HandlerInput
}
