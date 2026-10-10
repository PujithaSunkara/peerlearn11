
type UserAvatarProps = {
  name?: string;
  imageUrl?: string;
  size?: "sm" | "md" | "lg";
};

const sizeClasses = {
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-20 w-20 text-3xl",
};

export function UserAvatar({
  name = "Student",
  imageUrl,
  size = "md",
}: UserAvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "S";

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 font-bold text-white ${sizeClasses[size]}`}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`${name}'s avatar`}
          className="h-full w-full object-cover"
        />
      ) : (
        initial
      )}
    </div>
  );
}
