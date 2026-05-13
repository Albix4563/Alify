import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#121215] text-white">
      <h2 className="text-4xl font-bold text-sky-400 mb-4">404 - Not Found</h2>
      <p className="text-gray-400 mb-8">Could not find requested resource</p>
      <Link href="/">
        <button className="px-6 py-3 bg-sky-500 hover:bg-sky-400 text-white rounded-xl font-bold transition-all shadow-lg active:scale-95">
          Return Home
        </button>
      </Link>
    </div>
  );
}
