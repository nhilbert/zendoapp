import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import AppShell from './components/AppShell'
import InboxPage from './pages/InboxPage'
import ClarifyPage from './pages/ClarifyPage'
import TodayPage from './pages/TodayPage'
import WeekPage from './pages/WeekPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectPage from './pages/ProjectPage'
import BoardPage from './pages/BoardPage'
import ReviewPage from './pages/ReviewPage'
import SettingsPage from './pages/SettingsPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/today" replace /> },
      { path: 'today', element: <TodayPage /> },
      { path: 'week', element: <WeekPage /> },
      { path: 'inbox', element: <InboxPage /> },
      { path: 'clarify', element: <ClarifyPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:id', element: <ProjectPage /> },
      { path: 'board', element: <BoardPage /> },
      { path: 'review', element: <ReviewPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/today" replace /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
