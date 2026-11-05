#include <raytracing/geometry/include/geometry.h>
#include <raytracing/geometry/include/ray.h>
#include <raytracing/geometry/include/sphere.h>
#include <raytracing/geometry/include/triangle.h>

#include <cmath>

std::optional<Intersection> GetIntersection(const Ray& ray, const Sphere& sphere) {
    const Vector offset = ray.GetOrigin() - sphere.GetCenter();
    const double projection = DotProduct(offset, ray.GetDirection());
    const double discriminant = projection * projection - DotProduct(offset, offset) +
                                sphere.GetRadius() * sphere.GetRadius();
    if (discriminant < 0) {
        return std::nullopt;
    }

    const double root = std::sqrt(discriminant);
    double distance = -projection - root;
    if (distance < kEps) {
        distance = -projection + root;
    }
    if (distance < kEps) {
        return std::nullopt;
    }

    const Vector position = ray.GetOrigin() + ray.GetDirection() * distance;
    Vector normal = position - sphere.GetCenter();
    normal.Normalize();
    if (DotProduct(normal, ray.GetDirection()) > 0) {
        normal.Flip();
    }
    return Intersection{position, normal, distance};
}

std::optional<Intersection> GetIntersection(const Ray& ray, const Triangle& triangle) {
    const Vector edge_first = triangle[1] - triangle[0];
    const Vector edge_second = triangle[2] - triangle[0];
    const Vector direction_cross = CrossProduct(ray.GetDirection(), edge_second);
    const double determinant = DotProduct(edge_first, direction_cross);
    if (std::fabs(determinant) < kEps) {
        return std::nullopt;
    }

    const Vector offset = ray.GetOrigin() - triangle[0];
    const double weight_first = DotProduct(offset, direction_cross) / determinant;
    if (weight_first < -kEps || weight_first > 1 + kEps) {
        return std::nullopt;
    }

    const Vector offset_cross = CrossProduct(offset, edge_first);
    const double weight_second = DotProduct(ray.GetDirection(), offset_cross) / determinant;
    if (weight_second < -kEps || weight_first + weight_second > 1 + kEps) {
        return std::nullopt;
    }

    const double distance = DotProduct(edge_second, offset_cross) / determinant;
    if (distance < kEps) {
        return std::nullopt;
    }

    Vector normal = CrossProduct(edge_first, edge_second);
    normal.Normalize();
    if (DotProduct(normal, ray.GetDirection()) > 0) {
        normal.Flip();
    }
    return Intersection{ray.GetOrigin() + ray.GetDirection() * distance, normal, distance};
}

std::optional<Vector> Refract(const Vector& ray, const Vector& normal, double eta) {
    const double projection = DotProduct(normal, ray);
    const double discriminant = 1 - eta * eta * (1 - projection * projection);
    if (discriminant < 0) {
        return std::nullopt;
    }
    return eta * ray - (eta * projection + std::sqrt(discriminant)) * normal;
}

Vector Reflect(const Vector& ray, const Vector& normal) {
    return ray - 2 * DotProduct(normal, ray) * normal;
}

Vector GetBarycentricCoords(const Triangle& triangle, const Vector& point) {
    const Vector edge_first = triangle[1] - triangle[0];
    const Vector edge_second = triangle[2] - triangle[0];
    const Vector offset = point - triangle[0];
    const double first_squared = DotProduct(edge_first, edge_first);
    const double second_squared = DotProduct(edge_second, edge_second);
    const double mixed = DotProduct(edge_first, edge_second);
    const double offset_first = DotProduct(offset, edge_first);
    const double offset_second = DotProduct(offset, edge_second);
    const double denominator = first_squared * second_squared - mixed * mixed;

    const double weight_first =
        (second_squared * offset_first - mixed * offset_second) / denominator;
    const double weight_second =
        (first_squared * offset_second - mixed * offset_first) / denominator;
    return {1 - weight_first - weight_second, weight_first, weight_second};
}
