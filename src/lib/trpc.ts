import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../_core/routers";

export const trpc = createTRPCReact<AppRouter>();