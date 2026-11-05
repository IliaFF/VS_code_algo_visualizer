#pragma once

#include <raytracing/geometry/include/vector.h>
#include <raytracing/geometry/include/intersection.h>

#include <optional>

class Ray;
class Sphere;
class Triangle;

std::optional<Intersection> GetIntersection(const Ray& ray, const Sphere& sphere);
std::optional<Intersection> GetIntersection(const Ray& ray, const Triangle& triangle);

std::optional<Vector> Refract(const Vector& ray, const Vector& normal, double eta);
Vector Reflect(const Vector& ray, const Vector& normal);

Vector GetBarycentricCoords(const Triangle& triangle, const Vector& point);
