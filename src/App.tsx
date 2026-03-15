import { Navigate, Route, Routes } from 'react-router-dom'
import { AudioTools } from './pages/AudioTools'
import { LipSync } from './pages/LipSync'
import { Video } from './pages/Video'

export function App() {
  return (
    <Routes>
      <Route path='/' element={<Video />} />
      <Route path='/video' element={<Video />} />
      <Route path='/video-rapid' element={<Navigate to='/video?model=v4' replace />} />
      <Route path='/video-remix' element={<Navigate to='/video?model=v3' replace />} />
      <Route path='/fastmove' element={<Navigate to='/video?model=v1' replace />} />
      <Route path='/smoothmix' element={<Navigate to='/video?model=v2' replace />} />
      <Route path='/audio-tools' element={<AudioTools />} />
      <Route path='/lipsync' element={<LipSync />} />
      <Route path='/purchase' element={<Navigate to='/video' replace />} />
      <Route path='*' element={<Navigate to='/' replace />} />
    </Routes>
  )
}
