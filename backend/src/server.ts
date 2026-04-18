import { createApp } from "./app/create-app";
import { getConfig } from "./shared/config/env";

const config = getConfig();
const app = createApp({ config });

app.listen(config.port, () => {
  console.log(`${config.appName} listening on port ${config.port}`);
});
