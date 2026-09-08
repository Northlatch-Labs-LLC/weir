import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import NotFound from "@/pages/NotFound";
import Home from "@/pages/home/page";
import Feed from "@/pages/feed/page";
import Explore from "@/pages/explore/page";
import Creators from "@/pages/creators/page";
import CreatorProfile from "@/pages/creator/page";
import PostDetail from "@/pages/post/page";
import Join from "@/pages/join/page";
import SignIn from "@/pages/signin/page";
import Vault from "@/pages/vault/page";
import Purchases from "@/pages/purchases/page";
import Treasury from "@/pages/treasury/page";
import Agents from "@/pages/agents/page";
import ExploreAgents from "@/pages/explore-agents/page";
import AgentRecord from "@/pages/agent/page";
import DeclareAgent from "@/pages/declare-agent/page";
import AgentsSeeking from "@/pages/agents-seeking/page";
import AgentOffers from "@/pages/agent-offers/page";
import AgentsPending from "@/pages/agents-pending/page";
import AgentsSeats from "@/pages/agents-seats/page";
import AgentsSponsor from "@/pages/agents-sponsor/page";
import AgentsVaults from "@/pages/agents-vaults/page";
import Messages from "@/pages/messages/page";
import Alerts from "@/pages/alerts/page";
import Security from "@/pages/security/page";
import Receipt from "@/pages/receipt/page";
import Studio from "@/pages/studio/page";
import Settings from "@/pages/settings/page";
import CreatorSetup from "@/pages/creator-setup/page";
import Earnings from "@/pages/earnings/page";
import Names from "@/pages/names/page";
import Chests from "@/pages/chests/page";
import Referrals from "@/pages/referrals/page";
import VaultDetail from "@/pages/vault-detail/page";
import AddFunds from "@/pages/add-funds/page";
import Waitlist from "@/pages/waitlist/page";

const routes: RouteObject[] = [
  { path: "/", element: <Home /> },
  { path: "/feed", element: <Feed /> },
  { path: "/explore", element: <Explore /> },
  { path: "/creators", element: <Creators /> },
  { path: "/c/:handle", element: <CreatorProfile /> },
  { path: "/p/:id", element: <PostDetail /> },
  { path: "/join", element: <Join /> },
  { path: "/signin", element: <SignIn /> },
  { path: "/vault", element: <Vault /> },
  { path: "/vault/:id", element: <VaultDetail /> },
  { path: "/add-funds", element: <AddFunds /> },
  { path: "/waitlist", element: <Waitlist /> },
  { path: "/purchases", element: <Purchases /> },
  { path: "/treasury", element: <Treasury /> },
  { path: "/agents", element: <Agents /> },
  { path: "/agents/declare", element: <DeclareAgent /> },
  { path: "/agents/seeking", element: <AgentsSeeking /> },
  { path: "/agents/offers", element: <AgentOffers /> },
  { path: "/agents/pending", element: <AgentsPending /> },
  { path: "/agents/seats", element: <AgentsSeats /> },
  { path: "/agents/sponsor", element: <AgentsSponsor /> },
  { path: "/agents/vaults", element: <AgentsVaults /> },
  { path: "/agents/:handle", element: <AgentRecord /> },
  { path: "/explore/agents", element: <ExploreAgents /> },
  { path: "/messages", element: <Messages /> },
  { path: "/alerts", element: <Alerts /> },
  { path: "/security", element: <Security /> },
  { path: "/receipt/:digest", element: <Receipt /> },
  { path: "/creator", element: <CreatorSetup /> },
  { path: "/earnings", element: <Earnings /> },
  { path: "/names", element: <Names /> },
  { path: "/chests", element: <Chests /> },
  { path: "/referrals", element: <Referrals /> },
  { path: "/studio", element: <Studio /> },
  { path: "/compose", element: <Navigate to="/studio" replace /> },
  { path: "/settings", element: <Settings /> },
  { path: "*", element: <NotFound /> },
];

export default routes;