export default function Custom500() {
  return (
    <div style={{
      display: "flex",
      minHeight: "100vh",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <h1 style={{ fontSize: "4rem", fontWeight: "bold", marginBottom: "1rem" }}>
        500
      </h1>
      <p style={{ color: "#666", marginBottom: "2rem" }}>
        Erreur serveur
      </p>
      <a
        href="/"
        style={{
          backgroundColor: "#000",
          color: "#fff",
          padding: "0.75rem 1.5rem",
          borderRadius: "0.375rem",
          textDecoration: "none",
        }}
      >
        Retour à l&apos;accueil
      </a>
    </div>
  );
}
