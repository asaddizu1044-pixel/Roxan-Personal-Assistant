import { Toaster } from "sonner";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import Home from "./pages/Home";

export default function App() {
  return (
    <TooltipProvider>
      <Toaster />
      <Home />
    </TooltipProvider>
  );
}