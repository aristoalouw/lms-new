export const useAppShell = () => {
  const sidebarOpen = useState<boolean>('shell.sidebarOpen', () => false)
  const sidebarCompact = useState<boolean>('shell.sidebarCompact', () => false)
  const commandOpen = useState<boolean>('shell.commandOpen', () => false)
  const notificationsOpen = useState<boolean>('shell.notificationsOpen', () => false)

  const toggleSidebar = () => { sidebarOpen.value = !sidebarOpen.value }
  const closeSidebar = () => { sidebarOpen.value = false }
  const toggleCompact = () => { sidebarCompact.value = !sidebarCompact.value }

  return {
    sidebarOpen,
    sidebarCompact,
    commandOpen,
    notificationsOpen,
    toggleSidebar,
    closeSidebar,
    toggleCompact,
  }
}
