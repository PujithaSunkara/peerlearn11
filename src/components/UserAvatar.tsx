
type UserAvatarProps = {
  name?: string;
  imageUrl?: string;
  size?: number;
};

export function UserAvatar({
  name = "User",
  imageUrl,
  size = 48,
}: UserAvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "U";

  return (
    <div
      className="user-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        background: "linear-gradient(135deg, #6366f1, #a855f7)",
        color: "#ffffff",
        fontSize: size * 0.42,
        fontWeight: 700,
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`${name}'s avatar`}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : (
        initial
      )}
    </div>
  );
}
