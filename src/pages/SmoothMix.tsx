import { FastMove } from './FastMove'

export function SmoothMix() {
  return (
    <FastMove
      apiEndpoint='/api/wan-smoothmix'
      engineName='smoothmix'
      pageTitle='V2'
      activeNav='smoothmix'
      imageInputId='smoothmix-image-file'
      resultFilePrefix='smoothmix-result'
    />
  )
}
