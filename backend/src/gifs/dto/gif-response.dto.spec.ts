import { instanceToPlain } from 'class-transformer';
import { GifResultDto } from './gif-response.dto';

describe('GifResultDto', () => {
  const original = {
    id: 'gif-1',
    title: 'Cat',
    url: 'https://media.giphy.com/1/cat.gif',
    previewUrl: 'https://media.giphy.com/1/cat-preview.gif',
    width: 480,
    height: 270,
  };

  it('serializes a result with its medium and preview rendition metadata intact', () => {
    const dto: GifResultDto = {
      ...original,
      mediumUrl: 'https://media.giphy.com/1/cat-medium.gif',
      mediumWidth: 320,
      mediumHeight: 180,
      mediumSizeBytes: 1048576,
      originalSizeBytes: 4194304,
      previewWidth: 200,
      previewHeight: 113,
      previewSizeBytes: 262144,
    };

    expect(instanceToPlain(dto)).toEqual(dto);
  });

  it('leaves rendition metadata absent on the wire when the provider has none, rather than null', () => {
    const dto: GifResultDto = { ...original };

    expect(JSON.parse(JSON.stringify(instanceToPlain(dto)))).toEqual(original);
  });
});
