'use client'; // Error boundaries must be Client Components
 
import { useEffect } from 'react';
 
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
 
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#121215] text-white">
      <h2 className="text-4xl font-bold text-red-400 mb-4">Something went wrong!</h2>
      <p className="text-gray-400 mb-8">{error.message || 'An unexpected error occurred.'}</p>
      <button
        onClick={() => reset()}
        className="px-6 py-3 bg-red-500 hover:bg-red-400 text-white rounded-xl font-bold transition-all shadow-lg active:scale-95"
      >
        Try again
      </button>
    </div>
  );
}
