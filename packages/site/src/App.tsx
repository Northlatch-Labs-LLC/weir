import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./router";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import { ViewerProvider } from "@/lib/viewer-context";
import { WalletProvider } from "@/lib/wallet";


function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <WalletProvider>
        <ViewerProvider>
          <BrowserRouter basename={__BASE_PATH__}>
            <AppRoutes />
          </BrowserRouter>
        </ViewerProvider>
      </WalletProvider>
    </I18nextProvider>
  );
}

export default App;