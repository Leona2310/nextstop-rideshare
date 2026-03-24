const allowedDomains = [
  "sophiacollege.edu.in",
  "gmail.com"
];

export const isValidDomain = (email) => {
  if (!email || typeof email !== 'string') return false;
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return false;
  const domain = parts[1];
  return allowedDomains.includes(domain);
};
