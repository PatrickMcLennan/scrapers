export enum ImageExtension {
  png = `png`,
  jpg = `jpg`,
  jpeg = `jpeg`,
}

export type ImageDTO = {
  url: string;
  name: string;
  ext: ImageExtension;
};
