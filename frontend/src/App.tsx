import { AppStateProvider } from "./state/AppStateProvider";
import { useAppState } from "./state/appState";
import HomePage from "./components/HomePage";
import { Workspace } from "./components/Workspace";

function Screen() {
  const { view } = useAppState();
  return view === "home" ? <HomePage /> : <Workspace />;
}

export default function App() {
  return (
    <AppStateProvider>
      <Screen />
    </AppStateProvider>
  );
}
