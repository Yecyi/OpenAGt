const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://github.com/Yecyi/OpenAGt" : "https://github.com/Yecyi/OpenAGt",
  console: "https://github.com/Yecyi/OpenAGt",
  email: "",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/Yecyi/OpenAGt",
  discord: "",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
    { name: "nav.github", url: "https://github.com/Yecyi/OpenAGt" },
  ],
}
