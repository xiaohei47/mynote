import { useEffect, useState } from 'react';
import { Image } from 'antd';
import { imageData } from './storage';
import type { NoteImage as NoteImageData } from './storage';
export function NoteImage({ image }: { image: NoteImageData }) {
  const [data, setData] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true; setData(''); setFailed(false);
    void imageData(image).then(value => { if (active) setData(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [image.data, image.blob, image.type]);
  return data ? <Image src={data} alt={image.name} /> : <span>{failed ? '图片读取失败，请刷新重试。' : '…'}</span>;
}
